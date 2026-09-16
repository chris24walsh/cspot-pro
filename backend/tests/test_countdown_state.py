import json
from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.music.models import Song  # noqa: F401
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.presentation.models import PresentationPosition, PresentationSession
from app.modules.presentation.routes import (
    PresentationLiveStateWrite, PresentationOutputStatusWrite,
    _remember_countdown_start, advance_expired_auto_slide,
    update_presentation_live_state, update_presentation_output_status,
)
from app.modules.presentation.timing import countdown_deadline, welcome_advance_deadline


def test_countdown_start_survives_a_return_to_the_item():
    item = PlanItem(id="countdown-item", item_type="sermon", presentation_options={"overlay_mode": "countdown"})
    payload = {}

    _remember_countdown_start(payload, item, 1000)
    _remember_countdown_start(payload, item, 9000)

    assert payload["countdown_started_at"] == {"countdown-item": 1000}


def test_clock_time_countdown_needs_no_visit_start():
    item = PlanItem(id="clock-item", item_type="sermon", presentation_options={"overlay_mode": "countdown", "overlay_countdown_until": "11:00"})
    payload = {}

    _remember_countdown_start(payload, item, 1000)

    assert "countdown_started_at" not in payload


def test_welcome_navigation_resets_final_timer_but_preserves_and_respects_original_deadline(monkeypatch):
    monkeypatch.setattr("app.modules.presentation.routes.schedule_sermon_recording", lambda *args: None)
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        plan_type = PlanType(name="Timing test", active=True)
        session.add(plan_type)
        session.flush()
        plan = Plan(plan_type_id=plan_type.id, title="Timing test", service_date=datetime.now(UTC))
        session.add(plan)
        session.flush()
        montage = PlanItem(plan_id=plan.id, item_type="welcome_montage", title="Montage", sequence=10, presentation_options={"auto_advance": True, "auto_advance_seconds": 1500, "overlay_mode": "countdown", "overlay_countdown_seconds": 1800})
        final = PlanItem(plan_id=plan.id, item_type="welcome_countdown", title="Final countdown", sequence=20, presentation_options={"auto_advance": True, "auto_advance_seconds": 300, "overlay_mode": "countdown", "overlay_countdown_seconds": 300})
        seated = PlanItem(plan_id=plan.id, item_type="welcome_seated", title="Please be seated", sequence=30)
        session.add_all([montage, final, seated])
        live = PresentationSession(plan_id=plan.id, status="ready")
        session.add(live)
        session.flush()
        position = PresentationPosition(session_id=live.id)
        session.add(position)
        session.commit()
        start = int(datetime.now(UTC).timestamp() * 1000)
        user = SimpleNamespace(id="operator")
        items = [montage, final, seated]

        def select(item, minutes, **changes):
            return update_presentation_live_state(plan.id, PresentationLiveStateWrite(plan_id=plan.id, plan_item_id=item.id, index=items.index(item), updated_at=start + int(minutes * 60_000), **changes), user, session)

        # Browsing before starting the output must not consume countdown time.
        assert select(montage, -10).countdown_started_at == {}
        update_presentation_output_status(plan.id, PresentationOutputStatusWrite(owner_id="screen", heartbeat_at=start), user, session)
        assert select(final, 10).countdown_started_at[final.id] == start + 10 * 60_000
        returned = select(montage, 11)
        assert returned.countdown_started_at[montage.id] == start
        original_payload = json.loads(position.payload_json)
        assert countdown_deadline(montage, original_payload, items, plan.service_date, start) == start + 30 * 60_000
        assert welcome_advance_deadline(montage, original_payload, items, plan.service_date, start) == start + 25 * 60_000
        assert select(final, 12).countdown_started_at[final.id] == start + 12 * 60_000
        assert select(final, 13, blanked=True).countdown_started_at[final.id] == start + 12 * 60_000
        select(final, 14, blanked=False)
        advance_expired_auto_slide(session, live, position, plan.id, now_ms=start + 17 * 60_000 - 1)
        assert position.plan_item_id == final.id
        advance_expired_auto_slide(session, live, position, plan.id, now_ms=start + 17 * 60_000)
        assert position.plan_item_id == seated.id
        select(montage, 26)
        select(final, 27)
        advance_expired_auto_slide(session, live, position, plan.id, now_ms=start + 30 * 60_000)
        assert position.plan_item_id == seated.id
        select(montage, 31)
        select(final, 32)
        advance_expired_auto_slide(session, live, position, plan.id, now_ms=start + 32 * 60_000)
        assert position.plan_item_id == seated.id


def test_clock_target_caps_final_countdown_in_dublin_time():
    montage = PlanItem(id="montage", item_type="welcome_montage", presentation_options={"overlay_countdown_until": "11:00"})
    final = PlanItem(id="final", item_type="welcome_countdown", presentation_options={"overlay_countdown_seconds": 300})
    service_date = datetime(2026, 9, 20, 10, tzinfo=UTC)
    now = int(datetime(2026, 9, 20, 9, 58, tzinfo=UTC).timestamp() * 1000)
    assert countdown_deadline(final, {"countdown_started_at": {"final": now}}, [montage, final], service_date, now) == int(service_date.timestamp() * 1000)
