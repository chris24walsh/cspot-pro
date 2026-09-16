from datetime import datetime
from zoneinfo import ZoneInfo

from app.modules.planning.models import PlanItem


def countdown_deadline(item: PlanItem, payload: dict, items: list[PlanItem], service_date: datetime, fallback_start: int) -> int:
    options = item.presentation_options or {}
    starts = payload.get("countdown_started_at") or {}
    start = starts.get(item.id, fallback_start)
    duration = int(options.get("overlay_countdown_seconds") or (1800 if item.item_type == "welcome_montage" else 300))
    deadline = start + duration * 1000
    until = options.get("overlay_countdown_until")
    if until:
        try:
            hour, minute = map(int, until.split(":"))
            day = service_date.replace(tzinfo=ZoneInfo("UTC")) if service_date.tzinfo is None else service_date
            target = day.astimezone(ZoneInfo("Europe/Dublin")).replace(hour=hour, minute=minute, second=0, microsecond=0)
            clock_deadline = int(target.timestamp() * 1000)
            deadline = min(deadline, clock_deadline) if item.item_type == "welcome_countdown" else clock_deadline
        except (ValueError, TypeError):
            pass
    if item.item_type == "welcome_countdown":
        montage = next((candidate for candidate in items if candidate.item_type == "welcome_montage" and candidate.parent_item_id == item.parent_item_id), None)
        if montage and (montage.id in starts or (montage.presentation_options or {}).get("overlay_countdown_until")):
            deadline = min(deadline, countdown_deadline(montage, payload, items, service_date, fallback_start))
    return deadline


def welcome_advance_deadline(item: PlanItem, payload: dict, items: list[PlanItem], service_date: datetime, fallback_start: int) -> int | None:
    if item.item_type not in {"welcome_montage", "welcome_countdown"}:
        return None
    deadline = countdown_deadline(item, payload, items, service_date, fallback_start)
    if item.item_type == "welcome_montage":
        options = item.presentation_options or {}
        countdown_seconds = int(options.get("overlay_countdown_seconds") or 1800)
        advance_seconds = int(options.get("auto_advance_seconds") or options.get("dwell_seconds") or 1500)
        deadline -= max(0, countdown_seconds - advance_seconds) * 1000
    return deadline
