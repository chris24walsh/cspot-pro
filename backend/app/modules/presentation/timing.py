from datetime import datetime
from math import floor
from zoneinfo import ZoneInfo

from app.modules.planning.models import Plan, PlanItem, PlanType


def welcome_lead_seconds(items: list) -> int:
    montage = next((item for item in items if item.item_type == "welcome_montage"), None)
    countdown = next((item for item in items if item.item_type == "welcome_countdown"), None)
    if not montage or not countdown:
        return 0
    montage_options = montage.presentation_options or {}
    countdown_options = countdown.presentation_options or {}
    if not montage_options.get("auto_advance") or not countdown_options.get("auto_advance"):
        return 0
    return max(0, int(montage_options.get("auto_advance_seconds") or 0)) + max(0, int(countdown_options.get("overlay_countdown_seconds") or 300))


def shift_clock(value: str, seconds: int) -> str:
    hour, minute = map(int, value.split(":"))
    total = (hour * 60 + minute + floor(seconds / 60 + 0.5)) % 1440
    return f"{total // 60:02d}:{total % 60:02d}"


def service_start_for_plan(plan: Plan, plan_type: PlanType | None, items: list) -> str | None:
    if plan.service_start:
        return plan.service_start
    lead = welcome_lead_seconds(items)
    if plan.queued_start:
        return shift_clock(plan.queued_start, lead)
    if plan_type and plan_type.starts_at:
        if plan_type.starts_at != plan_type.automation_start:
            return plan_type.starts_at
        return shift_clock(plan_type.starts_at, lead)
    return None


def pre_service_start_for_plan(plan: Plan, items: list) -> str | None:
    if plan.service_start:
        return shift_clock(plan.service_start, -welcome_lead_seconds(items))
    return plan.queued_start


def countdown_deadline(item: PlanItem, payload: dict, items: list[PlanItem], service_date: datetime, fallback_start: int, service_start: str | None = None) -> int:
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
            deadline = min(deadline, clock_deadline)
        except (ValueError, TypeError):
            pass
    if service_start and item.item_type in {"welcome_montage", "welcome_countdown"}:
        hour, minute = map(int, service_start.split(":"))
        day = service_date.replace(tzinfo=ZoneInfo("UTC")) if service_date.tzinfo is None else service_date
        target = day.astimezone(ZoneInfo("Europe/Dublin")).replace(hour=hour, minute=minute, second=0, microsecond=0)
        deadline = min(deadline, int(target.timestamp() * 1000))
    if item.item_type == "welcome_countdown":
        montage = next((candidate for candidate in items if candidate.item_type == "welcome_montage" and candidate.parent_item_id == item.parent_item_id), None)
        if montage and (montage.id in starts or (montage.presentation_options or {}).get("overlay_countdown_until")):
            deadline = min(deadline, countdown_deadline(montage, payload, items, service_date, fallback_start, service_start))
    return deadline


def welcome_advance_deadline(item: PlanItem, payload: dict, items: list[PlanItem], service_date: datetime, fallback_start: int, service_start: str | None = None) -> int | None:
    if item.item_type not in {"welcome_montage", "welcome_countdown"}:
        return None
    deadline = countdown_deadline(item, payload, items, service_date, fallback_start, service_start)
    if item.item_type == "welcome_montage":
        options = item.presentation_options or {}
        advance_seconds = int(options.get("auto_advance_seconds") or options.get("dwell_seconds") or 1500)
        started_at = (payload.get("countdown_started_at") or {}).get(item.id, fallback_start)
        final = next((candidate for candidate in items if candidate.item_type == "welcome_countdown" and candidate.parent_item_id == item.parent_item_id), None)
        final_seconds = int((final.presentation_options or {}).get("overlay_countdown_seconds") or 300) if final else 300
        deadline = min(started_at + advance_seconds * 1000, deadline - final_seconds * 1000)
    return deadline
