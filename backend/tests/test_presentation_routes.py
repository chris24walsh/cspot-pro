from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.presentation.models import PresentationPosition, PresentationSession
from app.modules.presentation.routes import (
    PresentationOutputStatusWrite,
    _serialize_live_state,
    _serialize_output_status,
    update_presentation_output_status,
)


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
            '"video_action": "fade-stop", "video_action_at": 54321}'
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


def test_remote_release_prevents_the_closed_output_from_reclaiming() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[PresentationSession.__table__, PresentationPosition.__table__],
    )
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
        session.commit()

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

    assert released.active is False
    assert reclaimed.active is False
    assert reclaimed.claimed is False
