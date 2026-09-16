from datetime import UTC, datetime

from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.presentation.timing import countdown_deadline, pre_service_start_for_plan, service_start_for_plan, shift_clock, welcome_lead_seconds, welcome_advance_deadline


def test_service_start_derives_automatic_welcome_start_and_caps_late_start():
    plan_type = PlanType(name="Sunday", starts_at="11:00", automation_start="10:30")
    plan = Plan(plan_type_id="type", queued_start="10:30", service_date=datetime(2026, 9, 20, 10, tzinfo=UTC))
    montage = PlanItem(id="montage", item_type="welcome_montage", presentation_options={"auto_advance": True, "auto_advance_seconds": 1500, "overlay_countdown_seconds": 1800})
    final = PlanItem(id="final", item_type="welcome_countdown", presentation_options={"auto_advance": True, "overlay_countdown_seconds": 300})
    items = [montage, final]

    assert welcome_lead_seconds(items) == 1800
    assert shift_clock("11:00", -welcome_lead_seconds(items)) == "10:30"
    assert service_start_for_plan(plan, plan_type, items) == "11:00"

    late = int(datetime(2026, 9, 20, 9, 40, tzinfo=UTC).timestamp() * 1000)
    payload = {"countdown_started_at": {"montage": late}}
    assert countdown_deadline(montage, payload, items, plan.service_date, late, "11:00") == int(datetime(2026, 9, 20, 10, tzinfo=UTC).timestamp() * 1000)
    assert welcome_advance_deadline(montage, payload, items, plan.service_date, late, "11:00") == int(datetime(2026, 9, 20, 9, 55, tzinfo=UTC).timestamp() * 1000)


def test_explicit_service_start_survives_a_welcome_duration_change():
    plan = Plan(queued_start="10:30", service_start="11:00")
    plan_type = PlanType(starts_at="11:00", automation_start="10:30")
    items = [
        PlanItem(item_type="welcome_montage", presentation_options={"auto_advance": True, "auto_advance_seconds": 1200}),
        PlanItem(item_type="welcome_countdown", presentation_options={"auto_advance": True, "overlay_countdown_seconds": 300}),
    ]
    assert service_start_for_plan(plan, plan_type, items) == "11:00"
    assert pre_service_start_for_plan(plan, items) == "10:35"
    start = int(datetime(2026, 9, 20, 9, 35, tzinfo=UTC).timestamp() * 1000)
    payload = {"countdown_started_at": {items[0].id: start}}
    assert welcome_advance_deadline(items[0], payload, items, datetime(2026, 9, 20, 10, tzinfo=UTC), start, "11:00") == int(datetime(2026, 9, 20, 9, 55, tzinfo=UTC).timestamp() * 1000)


def test_custom_welcome_target_can_end_before_service_start():
    item = PlanItem(id="montage", item_type="welcome_montage", presentation_options={"overlay_countdown_seconds": 1800, "overlay_countdown_until": "10:50"})
    start = int(datetime(2026, 9, 20, 9, 40, tzinfo=UTC).timestamp() * 1000)
    assert countdown_deadline(item, {"countdown_started_at": {"montage": start}}, [item], datetime(2026, 9, 20, 10, tzinfo=UTC), start, "11:00") == int(datetime(2026, 9, 20, 9, 50, tzinfo=UTC).timestamp() * 1000)
