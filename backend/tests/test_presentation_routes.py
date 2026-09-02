import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.schemas import ServiceScheduleRule
from app.modules.planning.models import Plan, PlanType
from app.modules.presentation.models import PresentationPosition, PresentationSession
from app.modules.presentation.routes import (
    PresentationLiveStateWrite,
    PresentationOutputStatusWrite,
    _serialize_live_state,
    _serialize_output_status,
    admin_rehearsal_visible,
    cleanup_live_sessions,
    scheduled_service_window_active,
    update_presentation_live_state,
    update_presentation_output_status,
    welcome_stage_at,
)


def test_cleanup_live_sessions_keeps_only_selected_service_live() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine, tables=[PresentationSession.__table__, PresentationPosition.__table__]
    )
    with Session(engine) as session:
        selected = PresentationSession(plan_id="plan-2", status="live")
        superseded = PresentationSession(plan_id="plan-1", status="live")
        session.add_all([superseded, selected])
        session.flush()
        session.add(
            PresentationPosition(
                session_id=superseded.id,
                payload_json=(
                    '{"output_owner_id":"old-output","output_active":true,'
                    '"service_stage":"service"}'
                ),
            )
        )
        session.commit()

        assert cleanup_live_sessions(
            session,
            active_plan_id="plan-2",
            now=datetime(2026, 8, 30, 10, 0, tzinfo=UTC),
        ) == 1

        assert selected.status == "live"
        assert selected.ended_at is None
        assert superseded.status == "ended"
        assert superseded.ended_at == datetime(2026, 8, 30, 10, 0)
        superseded_payload = session.scalar(
            select(PresentationPosition.payload_json).where(
                PresentationPosition.session_id == superseded.id
            )
        )
        assert superseded_payload is not None
        assert '"output_closed_owner_id": "old-output"' in superseded_payload

        rejected = update_presentation_output_status(
            "plan-1",
            PresentationOutputStatusWrite(owner_id="old-output", heartbeat_at=12345),
            SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
            session,
        )
        assert rejected.active is False
        assert selected.status == "live"


def test_cleanup_live_sessions_ends_past_service_by_next_day() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            PlanType.__table__,
            Plan.__table__,
            PresentationSession.__table__,
            PresentationPosition.__table__,
        ],
    )
    with Session(engine) as session:
        plan_type = PlanType(name="Sunday Service", starts_at="10:30", active=True)
        session.add(plan_type)
        session.flush()
        plan = Plan(
            plan_type_id=plan_type.id,
            service_date=datetime(2026, 8, 30, 9, 30, tzinfo=UTC),
            title="Sunday Service",
            status="draft",
        )
        session.add(plan)
        session.flush()
        stale = PresentationSession(plan_id=plan.id, status="live")
        session.add(stale)
        session.commit()

        assert cleanup_live_sessions(
            session, now=datetime(2026, 8, 31, 0, 0, tzinfo=UTC)
        ) == 1
        assert stale.status == "ended"


def test_pre_service_rehearsal_is_visible_only_to_admins_before_output_starts() -> None:
    payload = {"service_stage": "pre_service", "pre_service_phase": "countdown"}

    assert admin_rehearsal_visible(payload, is_admin=True, output_active=False)
    assert not admin_rehearsal_visible(payload, is_admin=False, output_active=False)
    assert not admin_rehearsal_visible(payload, is_admin=True, output_active=True)
    assert not admin_rehearsal_visible(
        {**payload, "pre_service_phase": None}, is_admin=True, output_active=False
    )


def test_scheduled_service_window_is_limited_to_the_service_day() -> None:
    plan = SimpleNamespace(service_date=datetime(2026, 8, 30, 9, 30, tzinfo=UTC))

    assert scheduled_service_window_active(plan, datetime(2026, 8, 30, 10, 30, tzinfo=UTC))
    assert scheduled_service_window_active(plan, datetime(2026, 8, 30, 12, 30, tzinfo=UTC))
    assert not scheduled_service_window_active(plan, datetime(2026, 8, 30, 12, 31, tzinfo=UTC))
    assert not scheduled_service_window_active(plan, datetime(2026, 9, 6, 10, 30, tzinfo=UTC))


def test_scheduled_service_window_uses_configured_payload_times() -> None:
    plan = SimpleNamespace(service_date=datetime(2026, 9, 2, 9, 30, tzinfo=UTC))
    start = datetime(2026, 9, 2, 18, 30, tzinfo=UTC)
    end = datetime(2026, 9, 2, 21, 0, tzinfo=UTC)
    payload = {
        "scheduled_window_start": int(start.timestamp() * 1000),
        "scheduled_window_end": int(end.timestamp() * 1000),
    }

    assert scheduled_service_window_active(
        plan, datetime(2026, 9, 2, 19, 0, tzinfo=UTC), payload
    )
    assert not scheduled_service_window_active(
        plan, datetime(2026, 9, 2, 21, 1, tzinfo=UTC), payload
    )


def test_welcome_schedule_maps_to_three_child_items() -> None:
    rule = ServiceScheduleRule(
        id="sunday",
        name="Sunday morning",
        plan_type="Sunday Service",
        weekday=6,
        pre_service_start="10:30",
        countdown_start="10:55",
        service_start="11:00",
        cleanup_time="13:30",
    )

    assert welcome_stage_at(datetime(2026, 8, 30, 10, 30, tzinfo=UTC), rule) == (
        "welcome_montage",
        "montage",
    )
    assert welcome_stage_at(datetime(2026, 8, 30, 10, 55, tzinfo=UTC), rule) == (
        "welcome_countdown",
        "countdown",
    )
    assert welcome_stage_at(datetime(2026, 8, 30, 11, 0, tzinfo=UTC), rule) == (
        "welcome_seated",
        "complete",
    )


def test_non_admin_cannot_simulate_pre_service_timing() -> None:
    payload = PresentationLiveStateWrite(
        plan_id="plan-1",
        index=0,
        updated_at=12345,
        pre_service_phase="montage",
    )

    with (
        patch("app.modules.presentation.routes.list_role_names", return_value=["presenter"]),
        pytest.raises(HTTPException) as error,
    ):
        update_presentation_live_state(
            "plan-1",
            payload,
            SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
            SimpleNamespace(),  # type: ignore[arg-type]
        )

    assert error.value.status_code == 403


def test_live_state_serializes_payload_over_legacy_columns() -> None:
    presentation_session = PresentationSession(
        id="session-1",
        plan_id="plan-1",
        presenter_id="user-1",
        status="live",
    )
    position = PresentationPosition(
        id="position-1",
        session_id="session-1",
        plan_item_id="legacy-item",
        slide_index=3,
        payload_json=(
            '{"index": 8, "plan_item_id": "payload-item", "slide_offset": 2, '
            '"updated_at": 12345, "theme": "dark", "blanked": true, "fullscreen": true, '
            '"video_action": "fade-stop", "video_action_at": 54321, '
            '"service_stage": "pre_service", "pre_service_phase": "countdown"}'
        ),
    )

    state = _serialize_live_state(presentation_session, position, "plan-1")

    assert state.plan_id == "plan-1"
    assert state.session_id == "session-1"
    assert state.presenter_id == "user-1"
    assert state.status == "live"
    assert state.index == 8
    assert state.plan_item_id == "payload-item"
    assert state.slide_offset == 2
    assert state.updated_at == 12345
    assert state.theme == "dark"
    assert state.blanked is True
    assert state.fullscreen is True
    assert state.video_action == "fade-stop"
    assert state.video_action_at == 54321
    assert state.service_stage == "pre_service"
    assert state.pre_service_phase == "countdown"


def test_live_state_falls_back_to_ready_defaults_without_session() -> None:
    state = _serialize_live_state(None, None, "plan-1")

    assert state.plan_id == "plan-1"
    assert state.session_id is None
    assert state.status == "ready"
    assert state.index == 0
    assert state.theme == "light"
    assert state.blanked is False


def test_output_status_treats_recent_heartbeat_as_active() -> None:
    position = PresentationPosition(
        id="position-1",
        session_id="session-1",
        payload_json='{"output_owner_id": "owner-1", "output_heartbeat_at": 10000}',
    )

    status = _serialize_output_status("plan-1", position, now=13000)

    assert status.active is True
    assert status.owner_id == "owner-1"
    assert status.heartbeat_at == 10000


def test_output_status_ignores_stale_owner() -> None:
    position = PresentationPosition(
        id="position-1",
        session_id="session-1",
        payload_json='{"output_owner_id": "owner-1", "output_heartbeat_at": 10000}',
    )

    status = _serialize_output_status("plan-1", position, now=20000)

    assert status.active is False
    assert status.owner_id is None
    assert status.heartbeat_at is None


def test_explicit_output_remains_active_after_heartbeat_is_stale() -> None:
    position = PresentationPosition(
        id="position-1",
        session_id="session-1",
        payload_json=(
            '{"output_owner_id": "owner-1", "output_heartbeat_at": 10000, "output_active": true}'
        ),
    )

    status = _serialize_output_status("plan-1", position, now=20000)

    assert status.active is True
    assert status.owner_id == "owner-1"
    assert status.heartbeat_at == 10000


def test_remote_release_prevents_the_closed_output_from_reclaiming() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            PresentationSession.__table__,
            PresentationPosition.__table__,
            BroadcastViewerSettings.__table__,
        ],
    )
    scheduled: list[tuple[str | None, str | None]] = []
    with Session(engine) as session:
        presentation_session = PresentationSession(plan_id="plan-1", status="live")
        session.add(presentation_session)
        session.flush()
        session.add(
            PresentationPosition(
                session_id=presentation_session.id,
                payload_json=('{"output_owner_id": "output-1", "output_heartbeat_at": 10000}'),
            )
        )
        session.add(BroadcastViewerSettings(audio_scene_automation=True))
        session.commit()

        with (
            patch(
                "app.modules.presentation.routes.schedule_sermon_recording",
                side_effect=lambda _plan_id, previous_id, item_id, _offset, _user_id: (
                    scheduled.append((previous_id, item_id))
                ),
            ),
            patch("app.modules.presentation.routes.activate_audio_scene") as activate_scene,
        ):
            released = update_presentation_output_status(
                "plan-1",
                PresentationOutputStatusWrite(
                    owner_id="controller-on-another-device", heartbeat_at=11000, release=True
                ),
                SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
                session,
            )
            reclaimed = update_presentation_output_status(
                "plan-1",
                PresentationOutputStatusWrite(owner_id="output-1", heartbeat_at=12000),
                SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
                session,
            )
            released_payload = session.scalar(select(PresentationPosition.payload_json).limit(1))

    assert released.active is False
    assert reclaimed.active is False
    assert reclaimed.claimed is False
    assert scheduled == [(None, None)]
    assert released_payload is not None
    assert '"service_stage": "post_service"' in released_payload
    assert '"blanked": true' in released_payload
    activate_scene.assert_called_once()
    assert activate_scene.call_args.args[2] == "pre_service"


def test_routine_output_heartbeat_does_not_schedule_recording(monkeypatch) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            PresentationSession.__table__,
            PresentationPosition.__table__,
            BroadcastViewerSettings.__table__,
        ],
    )
    scheduled: list[tuple[str | None, str | None]] = []
    monkeypatch.setattr(
        "app.modules.presentation.routes.schedule_sermon_recording",
        lambda _plan_id, previous_id, item_id, _offset, _user_id: scheduled.append(
            (previous_id, item_id)
        ),
    )

    with Session(engine) as session:
        presentation_session = PresentationSession(plan_id="plan-1", status="live")
        session.add(presentation_session)
        session.flush()
        session.add(
            PresentationPosition(
                session_id=presentation_session.id,
                plan_item_id="sermon-a",
                payload_json=(
                    '{"plan_item_id": "sermon-a", "slide_offset": 2, '
                    '"output_recording_item_id": "sermon-a", '
                    '"output_owner_id": "output-1", "output_heartbeat_at": 10000}'
                ),
            )
        )
        session.commit()

        for heartbeat_at in range(12000, 12100):
            status = update_presentation_output_status(
                "plan-1",
                PresentationOutputStatusWrite(owner_id="output-1", heartbeat_at=heartbeat_at),
                SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
                session,
            )

    assert status.active is True
    assert scheduled == []


def test_new_output_on_sermon_schedules_one_recording_start(monkeypatch) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            PresentationSession.__table__,
            PresentationPosition.__table__,
            BroadcastViewerSettings.__table__,
        ],
    )
    scheduled: list[tuple[str | None, str | None, int]] = []
    monkeypatch.setattr(
        "app.modules.presentation.routes.schedule_sermon_recording",
        lambda _plan_id, previous_id, item_id, offset, _user_id: scheduled.append(
            (previous_id, item_id, offset)
        ),
    )

    with Session(engine) as session:
        presentation_session = PresentationSession(plan_id="plan-1", status="live")
        session.add(presentation_session)
        session.flush()
        session.add(
            PresentationPosition(
                session_id=presentation_session.id,
                plan_item_id="sermon-a",
                payload_json='{"plan_item_id": "sermon-a", "slide_offset": 3}',
            )
        )
        session.add(BroadcastViewerSettings(audio_scene_automation=True))
        session.commit()

        with (
            patch.object(
                session,
                "get",
                return_value=SimpleNamespace(item_type="sermon"),
            ),
            patch("app.modules.presentation.routes.activate_audio_scene") as activate_scene,
        ):
            status = update_presentation_output_status(
                "plan-1",
                PresentationOutputStatusWrite(owner_id="output-1", heartbeat_at=12000),
                SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
                session,
            )
        claimed_payload = session.scalar(select(PresentationPosition.payload_json).limit(1))

    assert status.claimed is True
    assert scheduled == [(None, "sermon-a", 3)]
    assert claimed_payload is not None
    assert '"service_stage": "service"' in claimed_payload
    activate_scene.assert_called_once()
    assert activate_scene.call_args.args[2] == "pastor"


@pytest.mark.parametrize(
    ("item_type", "video_action", "service_stage", "expected_scene"),
    [
        ("pre_service", None, "pre_service", "pastor"),
        (None, None, "post_service", "pastor"),
        ("song", "play", "service", "worship"),
        ("video", "play", "service", "media"),
        ("song", None, "service", "worship"),
    ],
)
def test_new_output_derives_scene_from_current_presentation_state(
    item_type: str | None,
    video_action: str | None,
    service_stage: str,
    expected_scene: str,
) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            PresentationSession.__table__,
            PresentationPosition.__table__,
            BroadcastViewerSettings.__table__,
        ],
    )
    state = {
        "plan_item_id": "current-item",
        "slide_offset": 0,
        "service_stage": service_stage,
    }
    if video_action is not None:
        state["video_action"] = video_action

    with Session(engine) as session:
        presentation_session = PresentationSession(plan_id="plan-1", status="live")
        session.add(presentation_session)
        session.flush()
        session.add(
            PresentationPosition(
                session_id=presentation_session.id,
                plan_item_id="current-item",
                payload_json=json.dumps(state),
            )
        )
        session.add(BroadcastViewerSettings(audio_scene_automation=True))
        session.commit()

        with (
            patch.object(
                session,
                "get",
                return_value=(SimpleNamespace(item_type=item_type) if item_type else None),
            ),
            patch("app.modules.presentation.routes.schedule_sermon_recording"),
            patch("app.modules.presentation.routes.activate_audio_scene") as activate_scene,
        ):
            update_presentation_output_status(
                "plan-1",
                PresentationOutputStatusWrite(owner_id="output-1", heartbeat_at=12000),
                SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
                session,
            )

    activate_scene.assert_called_once()
    assert activate_scene.call_args.args[2] == expected_scene


def test_starting_service_defers_audio_scene_change_for_the_program_fade() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            PresentationSession.__table__,
            PresentationPosition.__table__,
            BroadcastViewerSettings.__table__,
        ],
    )
    now = int(datetime.now(UTC).timestamp() * 1000)

    with Session(engine) as session:
        presentation_session = PresentationSession(plan_id="plan-1", status="live")
        session.add(presentation_session)
        session.flush()
        session.add(
            PresentationPosition(
                session_id=presentation_session.id,
                payload_json=json.dumps(
                    {
                        "service_stage": "pre_service",
                        "output_owner_id": "output-1",
                        "output_heartbeat_at": now,
                        "output_active": True,
                    }
                ),
            )
        )
        session.add(BroadcastViewerSettings(audio_scene_automation=True))
        session.commit()

        with (
            patch("app.modules.presentation.routes.activate_audio_scene") as activate_scene,
            patch(
                "app.modules.presentation.routes._schedule_audio_scene_after_program_fade"
            ) as schedule_scene,
        ):
            update_presentation_live_state(
                "plan-1",
                PresentationLiveStateWrite(
                    plan_id="plan-1",
                    updated_at=now + 1,
                    service_stage="service",
                ),
                SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
                session,
            )

    activate_scene.assert_not_called()
    schedule_scene.assert_called_once_with("plan-1")


def test_live_state_only_schedules_real_sermon_slide_changes(monkeypatch) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            PresentationSession.__table__,
            PresentationPosition.__table__,
            BroadcastViewerSettings.__table__,
        ],
    )
    scheduled: list[tuple[str | None, str | None, int]] = []
    monkeypatch.setattr(
        "app.modules.presentation.routes.schedule_sermon_recording",
        lambda _plan_id, previous_id, item_id, offset, _user_id: scheduled.append(
            (previous_id, item_id, offset)
        ),
    )
    now = int(datetime.now(UTC).timestamp() * 1000)

    with Session(engine) as session:
        presentation_session = PresentationSession(plan_id="plan-1", status="live")
        session.add(presentation_session)
        session.flush()
        session.add(
            PresentationPosition(
                session_id=presentation_session.id,
                plan_item_id="sermon-a",
                slide_index=4,
                payload_json=(
                    '{"plan_item_id": "sermon-a", "slide_offset": 2, '
                    '"output_recording_item_id": "sermon-a", '
                    f'"output_owner_id": "output-1", "output_heartbeat_at": {now}'
                    "}"
                ),
            )
        )
        session.commit()

        unchanged = PresentationLiveStateWrite(
            plan_id="plan-1",
            index=4,
            plan_item_id="sermon-a",
            slide_offset=2,
            updated_at=now + 1,
        )
        update_presentation_live_state(
            "plan-1",
            unchanged,
            SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
            session,
        )
        blanked = unchanged.model_copy(update={"blanked": True, "updated_at": now + 2})
        update_presentation_live_state(
            "plan-1",
            blanked,
            SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
            session,
        )
        changed = unchanged.model_copy(
            update={"index": 5, "slide_offset": 3, "updated_at": now + 3}
        )
        update_presentation_live_state(
            "plan-1",
            changed,
            SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
            session,
        )

    assert scheduled == [("sermon-a", "sermon-a", 3)]
