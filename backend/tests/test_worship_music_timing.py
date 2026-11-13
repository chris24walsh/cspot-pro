import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, update
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.music.models import Song
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.presentation.models import PresentationPosition, PresentationSession
from app.modules.presentation.routes import (
    PresentationLiveStateWrite,
    WorshipMusicTiming,
    WorshipMusicTimingCommand,
    WorshipMusicTimingHeartbeat,
    _persist_timing_state,
    command_worship_music_timing,
    get_worship_music_timing,
    heartbeat_worship_music_timing,
    update_presentation_live_state,
    update_worship_music_timing,
)


@pytest.fixture
def timing_context():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        kind = PlanType(name="Timing test", active=True)
        song = Song(title="Timing song")
        session.add_all([kind, song])
        session.flush()
        plan = Plan(
            plan_type_id=kind.id,
            service_date=datetime.now(UTC),
            title="Timing test",
            status="draft",
        )
        session.add(plan)
        session.flush()
        item = PlanItem(
            plan_id=plan.id, sequence=10, item_type="song", title=song.title, song_id=song.id
        )
        session.add(item)
        session.flush()
        live = PresentationSession(plan_id=plan.id, status="ready")
        session.add(live)
        session.flush()
        position = PresentationPosition(
            session_id=live.id,
            payload_json=json.dumps(
                {"index": 7, "slide_offset": 2, "updated_at": 123, "worship_coupled": True}
            ),
        )
        session.add(position)
        session.commit()
        payload = WorshipMusicTiming(
            owner_id="host",
            song_id=song.id,
            plan_item_id=item.id,
            start_index=3,
            first_bar_stop=1,
            position=0.25,
            bar_duration_ms=2000,
            total_bars=8,
        )
        yield session, plan, position, payload
    engine.dispose()


@pytest.mark.parametrize("role", ["administrator", "worship_leader"])
def test_shared_clock_preserves_service_state_and_stops(timing_context, role):
    session, plan, position, payload = timing_context
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=[role]):
        response = command_worship_music_timing(
            plan.id,
            WorshipMusicTimingCommand(command_id="start-1", expected_revision=0, action="start", timing=payload),
            SimpleNamespace(id="admin"), session,
        )
        assert response.timing.position == 0.25
        assert response.revision == 1
        assert response.timing.updated_at == response.server_now
        assert response.timing.owner_id == "host"
        data = json.loads(position.payload_json)
        assert data["index"] == 7
        assert data["updated_at"] == 123
        assert data["worship_coupled"] is True
        read = get_worship_music_timing(plan.id, None, session)
        assert read.timing.start_index == 3
        assert read.timing.first_bar_stop == 1
        stopped = command_worship_music_timing(
            plan.id,
            WorshipMusicTimingCommand(
                command_id="stop-1", expected_revision=1, action="stop", owner_id="host",
            ),
            SimpleNamespace(id="admin"), session,
        )
        assert stopped.timing is None
        assert stopped.status == "stopped"
        assert stopped.revision == 2


def test_sharing_rejects_musicians_and_has_one_controller(timing_context):
    session, plan, _position, payload = timing_context
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["musician"]):
        with pytest.raises(HTTPException) as error:
            command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
                command_id="bad", expected_revision=0, action="start", timing=payload,
            ), SimpleNamespace(id="musician"), session)
        assert error.value.status_code == 403
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["administrator"]):
        command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="owner-start", expected_revision=0, action="start", timing=payload,
        ), SimpleNamespace(id="admin"), session)
        payload.owner_id = "other-device"
        with pytest.raises(HTTPException) as error:
            command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
                command_id="other-start", expected_revision=1, action="start", timing=payload,
            ), SimpleNamespace(id="admin"), session)
        assert error.value.status_code == 409


def test_commands_are_revisioned_idempotent_and_stop_is_a_tombstone(timing_context):
    session, plan, _position, timing = timing_context
    leader = SimpleNamespace(id="leader")
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["worship_leader"]):
        start = WorshipMusicTimingCommand(
            command_id="stable-start", expected_revision=0, action="start", timing=timing,
        )
        started = command_worship_music_timing(plan.id, start, leader, session)
        replay = command_worship_music_timing(plan.id, start, leader, session)
        assert replay.revision == started.revision == 1
        assert replay.session_id == started.session_id
        with pytest.raises(HTTPException) as stale:
            command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
                command_id="old-write", expected_revision=0, action="reseat", timing=timing,
            ), leader, session)
        assert stale.value.status_code == 409
        stopped = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="leader-stop", expected_revision=1, action="stop", owner_id="host",
        ), leader, session)
        assert stopped.status == "stopped"
        assert stopped.revision == 2
        assert get_worship_music_timing(plan.id, leader, session).timing is None
        replay_after_stop = command_worship_music_timing(plan.id, start, leader, session)
        assert replay_after_stop.revision == 1
        assert replay_after_stop.session_id == started.session_id


def test_reseat_schedules_and_heartbeat_cannot_rewrite_timeline(timing_context):
    session, plan, _position, timing = timing_context
    owner = SimpleNamespace(id="admin")
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["administrator"]):
        started = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="start-clock", expected_revision=0, action="start", timing=timing,
        ), owner, session)
        destination = timing.model_copy(update={
            "position": 3.0,
            "owner_id": "seeking-device",
            "updated_at": 1,
        })
        reseated = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="reseat-clock", expected_revision=1, action="reseat", timing=destination,
        ), owner, session)
        assert reseated.revision == 2
        assert reseated.pending is not None
        assert reseated.pending.timing.position == 3
        assert reseated.pending.timing.owner_id == "host"
        assert reseated.pending.timing.updated_at >= reseated.pending.effective_at
        assert reseated.timing.position == 0.25
        heartbeat_worship_music_timing(plan.id, SimpleNamespace(
            session_id=started.session_id, revision=1, owner_id="host",
        ), owner, session)
        reread = get_worship_music_timing(plan.id, owner, session)
        assert reread.revision == 2
        assert reread.timing.position == 0.25
        assert reread.pending.timing.position == 3


def test_reseats_supersede_and_activate_without_owner_ack(timing_context):
    session, plan, _position, timing = timing_context
    leader = SimpleNamespace(id="owner-user")
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["administrator"]):
        started = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="start-pending", expected_revision=0, action="start", timing=timing,
        ), leader, session)
        first_destination = timing.model_copy(update={"position": 2.0})
        command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="reseat-first", expected_revision=1, action="reseat", timing=first_destination,
        ), leader, session)
        second_destination = timing.model_copy(update={"position": 5.0})
        second = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="reseat-second", expected_revision=2, action="reseat", timing=second_destination,
        ), leader, session)
        assert second.pending.command_id == "reseat-second"
        assert second.pending.timing.position == 5
        effective_at = second.pending.effective_at + 20_000

        with patch("app.modules.presentation.routes.datetime") as server_clock:
            server_clock.now.return_value = datetime.fromtimestamp(effective_at / 1000, UTC)
            snapshot = get_worship_music_timing(plan.id, leader, session)
        assert snapshot.revision == 3
        assert snapshot.pending is None
        assert snapshot.timing.position == 5
        assert snapshot.owner.connected is False
        assert snapshot.owner.last_seen_at == started.owner.last_seen_at


def test_admin_stop_defeats_stale_heartbeat_and_start(timing_context):
    session, plan, _position, timing = timing_context
    owner = SimpleNamespace(id="owner-user")
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["administrator"]):
        started = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="admin-start", expected_revision=0, action="start", timing=timing,
        ), owner, session)
        command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="admin-reseat", expected_revision=1, action="reseat", timing=timing,
        ), owner, session)
        stopped = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="admin-stop", expected_revision=2, action="stop",
        ), SimpleNamespace(id="another-admin"), session)
        assert stopped.status == "stopped"
        assert stopped.revision == 3
        ignored = heartbeat_worship_music_timing(
            plan.id,
            WorshipMusicTimingHeartbeat(
                session_id=started.session_id, revision=1, owner_id="host",
            ),
            owner,
            session,
        )
        assert ignored.status == "stopped"
        assert ignored.revision == 3
        with pytest.raises(HTTPException) as stale_start:
            command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
                command_id="stale-restart", expected_revision=2, action="start", timing=timing,
            ), owner, session)
        assert stale_start.value.status_code == 409
        assert get_worship_music_timing(plan.id, owner, session).revision == 3


def test_owner_health_is_independent_of_accepted_clock(timing_context):
    session, plan, _position, timing = timing_context
    owner = SimpleNamespace(id="admin")
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["administrator"]):
        started = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="health-start", expected_revision=0, action="start", timing=timing,
        ), owner, session)
    with patch("app.modules.presentation.routes.datetime") as server_clock:
        server_clock.now.return_value = datetime.fromtimestamp(
            (started.owner.last_seen_at + 13_000) / 1000, UTC,
        )
        snapshot = get_worship_music_timing(plan.id, owner, session)
    assert snapshot.status == "running"
    assert snapshot.timing is not None
    assert snapshot.owner.connected is False


def test_natural_clock_completion_allows_only_explicit_new_start(timing_context):
    session, plan, _position, timing = timing_context
    leader = SimpleNamespace(id="admin")
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["administrator"]):
        started = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="finite-start", expected_revision=0, action="start", timing=timing,
        ), leader, session)
        with patch("app.modules.presentation.routes.datetime") as server_clock:
            server_clock.now.return_value = datetime.fromtimestamp(
                (started.timing.updated_at + 20_000) / 1000, UTC,
            )
            restarted = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
                command_id="deliberate-restart",
                expected_revision=1,
                action="start",
                timing=timing,
            ), leader, session)
    assert restarted.revision == 2
    assert restarted.session_id == "deliberate-restart"


def test_legacy_timestamp_publisher_cannot_resurrect_stopped_clock(timing_context):
    session, plan, _position, timing = timing_context
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["administrator"]):
        with pytest.raises(HTTPException) as error:
            update_worship_music_timing(plan.id, timing, SimpleNamespace(id="admin"), session)
    assert error.value.status_code == 409
    assert error.value.detail["code"] == "revision_required"


def test_legacy_clock_is_ignored_without_changing_slides(timing_context):
    session, plan, position, payload = timing_context
    payload.updated_at = int(datetime.now(UTC).timestamp() * 1000) - 13000
    data = json.loads(position.payload_json)
    data["music_timing"] = payload.model_dump()
    position.payload_json = json.dumps(data)
    session.commit()
    assert get_worship_music_timing(plan.id, None, session).timing is None
    assert json.loads(position.payload_json)["index"] == 7


def test_band_selection_is_independent_and_last_writer_wins(timing_context):
    from app.modules.presentation.routes import (
        BandSelection,
        get_band_selection,
        update_band_selection,
    )

    session, plan, position, timing = timing_context
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["administrator"]):
        command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="before-band-write", expected_revision=0, action="start", timing=timing,
        ), SimpleNamespace(id="admin"), session)
    assert get_band_selection(plan.id, None, session).selection is None
    first = update_band_selection(
        plan.id, BandSelection(slide_id="first"), SimpleNamespace(id="musician"), session
    )
    second = update_band_selection(
        plan.id, BandSelection(slide_id="second"), SimpleNamespace(id="another"), session
    )
    assert second.selection.updated_at > first.selection.updated_at
    assert get_band_selection(plan.id, None, session).selection.slide_id == "second"
    data = json.loads(position.payload_json)
    assert data["index"] == 7
    assert data["slide_offset"] == 2
    assert data["updated_at"] == 123
    assert data["worship_coupled"] is True
    assert data["music_timing_state"]["revision"] == 1
    assert data["music_timing_state"]["timing"]["song_id"] == timing.song_id


def test_service_navigation_writer_preserves_shared_timing(timing_context):
    session, plan, position, timing = timing_context
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["administrator"]):
        command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="before-service-navigation",
            expected_revision=0,
            action="start",
            timing=timing,
        ), SimpleNamespace(id="admin"), session)
    update_presentation_live_state(
        plan.id,
        PresentationLiveStateWrite(
            plan_id=plan.id,
            index=8,
            updated_at=124,
            expected_updated_at=123,
        ),
        SimpleNamespace(id="admin"),
        session,
    )
    saved = json.loads(position.payload_json)
    assert saved["index"] == 8
    assert saved["music_timing_state"]["revision"] == 1


def test_timing_compare_and_swap_rejects_concurrent_service_writer(timing_context):
    session, _plan, position, _timing = timing_context
    before = position.payload_json
    concurrent = json.loads(before)
    concurrent["band_selection"] = {"slide_id": "updated-by-band"}
    session.execute(
        update(PresentationPosition)
        .where(PresentationPosition.id == position.id)
        .values(payload_json=json.dumps(concurrent))
        .execution_options(synchronize_session=False)
    )
    position_id = position.id
    session_id = position.session_id
    session.commit()
    stale_position = PresentationPosition(
        id=position_id,
        session_id=session_id,
        payload_json=before,
    )
    proposed = json.loads(before)
    proposed["music_timing_state"] = {"revision": 1, "status": "running"}
    with pytest.raises(HTTPException) as conflict:
        _persist_timing_state(session, stale_position, proposed)
    assert conflict.value.status_code == 409
    session.expire(position)
    assert json.loads(position.payload_json)["band_selection"]["slide_id"] == "updated-by-band"


@pytest.mark.parametrize("area_key,approval,allowed", [
    ("worship", "approved", True),
    ("worship", "pending", False),
    ("worship_musician", "approved", False),
])
def test_sharing_uses_approved_serving_roles(timing_context, area_key, approval, allowed):
    from app.modules.identity.models import ServingArea, User, VolunteerPreference

    session, plan, _position, payload = timing_context
    user = User(email="leader@example.com", username="leader", name="Leader")
    area = ServingArea(key=area_key, name="Worship", category="Worship")
    session.add_all([user, area])
    session.flush()
    session.add(VolunteerPreference(
        user_id=user.id, serving_area_id=area.id, status=approval,
    ))
    session.commit()
    if allowed:
        worship_type = PlanType(name="Worship Set", active=True)
        session.add(worship_type)
        session.flush()
        worship_plan = Plan(
            plan_type_id=worship_type.id,
            service_date=plan.service_date,
            title="Worship set",
            status="draft",
        )
        session.add(worship_plan)
        session.flush()
        session.add(PlanItem(
            plan_id=plan.id,
            sequence=20,
            item_type="worship_set",
            title="Worship",
        ))
        worship_song = PlanItem(
            plan_id=worship_plan.id,
            sequence=10,
            item_type="song",
            title="Linked song",
            song_id=payload.song_id,
        )
        session.add(worship_song)
        session.flush()
        linked_payload = payload.model_copy(update={"plan_item_id": worship_song.id})
        result = command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="approved-start", expected_revision=0, action="start", timing=linked_payload,
        ), user, session)
        assert result.timing.active
        assert get_worship_music_timing(plan.id, user, session).timing.owner_id == "host"
    else:
        with pytest.raises(HTTPException) as error:
            command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
                command_id="unapproved-start", expected_revision=0, action="start", timing=payload,
            ), user, session)
        assert error.value.status_code == 403


def test_timing_accepts_full_intro_and_count_in_window(timing_context):
    from pydantic import ValidationError

    payload = timing_context[3].model_dump()
    assert WorshipMusicTiming.model_validate({**payload, "position": -17.05}).position == -17.05
    with pytest.raises(ValidationError):
        WorshipMusicTiming.model_validate({**payload, "position": -19})


def test_shared_timing_preserves_mixed_meter_durations(timing_context):
    session, plan, _position, payload = timing_context
    payload.bar_durations_ms = [2000, 1000, 1500, 2000, 2000, 2000, 2000, 2000]
    with patch("app.modules.presentation.routes.list_authorization_role_names", return_value=["administrator"]):
        command_worship_music_timing(plan.id, WorshipMusicTimingCommand(
            command_id="mixed-start", expected_revision=0, action="start", timing=payload,
        ), SimpleNamespace(id="admin"), session)
    assert get_worship_music_timing(plan.id, None, session).timing.bar_durations_ms == payload.bar_durations_ms


@pytest.mark.parametrize("duration", [0, -1, float("inf"), float("nan")])
def test_shared_timing_rejects_invalid_bar_durations(timing_context, duration):
    from pydantic import ValidationError

    value = timing_context[3].model_dump()
    value["bar_durations_ms"] = [duration]
    with pytest.raises(ValidationError):
        WorshipMusicTiming.model_validate(value)
