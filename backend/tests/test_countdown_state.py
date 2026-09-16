from app.modules.planning.models import PlanItem
from app.modules.presentation.routes import _remember_countdown_start


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
