"""Resolve the temporary remote program override without changing church settings."""

from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urljoin

from sqlalchemy.orm import object_session

from app.core.config import settings as app_settings
from app.modules.broadcast.models import BroadcastContribution


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def connected(guest: BroadcastContribution) -> bool:
    now = datetime.now(UTC)
    return bool(
        not guest.revoked_at
        and utc(guest.expires_at) > now
        and guest.last_seen_at
        and utc(guest.last_seen_at) > now - timedelta(seconds=25)
    )


def active_contribution(settings):
    guest_id = getattr(settings, "remote_contribution_id", None)
    if not guest_id:
        return None
    session = object_session(settings)
    guest = session.get(BroadcastContribution, guest_id) if session and guest_id else None
    return guest if guest and connected(guest) else None


def stream_name(guest, *, raw=False):
    return f"cspot-guest-{'raw-' if raw else ''}{guest.id}"


def audio_source(guest):
    from app.modules.broadcast.schemas import BroadcastAudioSource

    return BroadcastAudioSource(
        id=f"guest-{guest.id}",
        label=guest.label,
        url=urljoin(app_settings.camera_proxy_upstream.rstrip("/") + "/", "api/stream.mp4")
        + "?"
        + urlencode({"src": stream_name(guest)}),
    )
