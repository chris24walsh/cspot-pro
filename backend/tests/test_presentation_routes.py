from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.presentation.models import PresentationPosition, PresentationSession
from app.modules.presentation.routes import (
    PresentationLiveStateWrite,
    PresentationOutputStatusWrite,
    _serialize_live_state,
    _serialize_output_status,
    scheduled_service_window_active,
    update_presentation_live_state,
    update_presentation_output_status,
)


def test_scheduled_service_window_is_limited_to_the_service_day() -> None:
    plan = SimpleNamespace(service_date=datetime(2026, 8, 30, 9, 30, tzinfo=UTC))

    assert scheduled_service_window_active(
        plan, datetime(2026, 8, 30, 10, 30, tzinfo=UTC)
    )
    assert scheduled_service_window_active(
        plan, datetime(2026, 8, 30, 12, 30, tzinfo=UTC)
    )
    assert not scheduled_service_window_active(
        plan, datetime(2026, 8, 30, 12, 31, tzinfo=UTC)
    )
    assert not scheduled_service_window_active(
        plan, datetime(2026, 9, 6, 10, 30, tzinfo=UTC)
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
            '{"output_owner_id": "owner-1", "output_heartbeat_at": 10000, '
            '"output_active": true}'
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
                payload_json=(
                    '{"output_owner_id": "output-1", "output_heartbeat_at": 10000}'
                ),
            )
        )
        session.add(BroadcastViewerSettings(audio_scene_automation=True))
        session.commit()

        with patch(
            "app.modules.presentation.routes.schedule_sermon_recording",
            side_effect=lambda _plan_id, previous_id, item_id, _offset, _user_id: scheduled.append(
                (previous_id, item_id)
            ),
        ), patch("app.modules.presentation.routes.activate_audio_scene") as activate_scene:
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
            released_payload = session.scalar(
                select(PresentationPosition.payload_json).limit(1)
            )

    assert released.active is False
    assert reclaimed.active is False
    assert reclaimed.claimed is False
    assert scheduled == [(None, None)]
    assert released_payload is not None
    assert '"service_stage": "post_service"' in released_payload
    assert '"blanked": true' in released_payload
    activate_scene.assert_called_once()
    assert activate_scene.call_args.args[2] == "media"


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
                PresentationOutputStatusWrite(
                    owner_id="output-1", heartbeat_at=heartbeat_at
                ),
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

        with patch("app.modules.presentation.routes.activate_audio_scene") as activate_scene:
            status = update_presentation_output_status(
                "plan-1",
                PresentationOutputStatusWrite(owner_id="output-1", heartbeat_at=12000),
                SimpleNamespace(id="user-1"),  # type: ignore[arg-type]
                session,
            )
        claimed_payload = session.scalar(
            select(PresentationPosition.payload_json).limit(1)
        )

    assert status.claimed is True
    assert scheduled == [(None, "sermon-a", 3)]
    assert claimed_payload is not None
    assert '"service_stage": "service"' in claimed_payload
    activate_scene.assert_called_once()
    assert activate_scene.call_args.args[2] == "pastor"


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
        blanked = unchanged.model_copy(
            update={"blanked": True, "updated_at": now + 2}
        )
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
