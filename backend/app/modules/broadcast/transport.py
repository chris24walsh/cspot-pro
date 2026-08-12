import hashlib
import logging
from collections.abc import Iterable
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests

from app.core.config import settings
from app.modules.broadcast.schemas import BroadcastAudioSource, BroadcastCameraSource

logger = logging.getLogger(__name__)

GO2RTC_AUDIO_STREAM_PREFIX = "cspot-audio-"
GO2RTC_REQUEST_TIMEOUT = (2, 5)


def _http_source_url(source: BroadcastAudioSource) -> str | None:
    value = source.url.strip()
    try:
        parsed = urlsplit(value)
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    # URL fragments are local browser state and would otherwise be interpreted
    # as go2rtc FFmpeg source options.
    return urlunsplit((parsed.scheme.lower(), parsed.netloc, parsed.path, parsed.query, ""))


def audio_stream_name(source: BroadcastAudioSource) -> str | None:
    """Return a stable, opaque go2rtc stream name for an HTTP audio source."""

    source_url = _http_source_url(source)
    if source_url is None:
        return None
    digest = hashlib.sha256(f"{source.id}\0{source_url}".encode()).hexdigest()[:24]
    return f"{GO2RTC_AUDIO_STREAM_PREFIX}{digest}"


def camera_stream_name(source: BroadcastCameraSource) -> str | None:
    """Return the configured go2rtc name from a proxied camera URL."""

    try:
        parsed = urlsplit(source.url)
    except ValueError:
        return None
    if not parsed.path.endswith("/camera/api/stream.m3u8"):
        return None
    for key, value in (
        pair.split("=", 1) if "=" in pair else (pair, "")
        for pair in parsed.query.split("&")
    ):
        if key == "src" and value:
            # Configured stream names use CSpot/go2rtc's URL-safe identifiers.
            # Reject source-like values so this allowlist can never authorize a
            # dynamic ffmpeg/http/rtsp input through the WebSocket endpoint.
            if all(character.isalnum() or character in "._-" for character in value):
                return value
            return None
    return None


def _go2rtc_streams_url() -> str | None:
    upstream = (settings.camera_proxy_upstream or "").strip()
    if not upstream:
        return None
    try:
        parsed = urlsplit(upstream)
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    return urljoin(upstream.rstrip("/") + "/", "api/streams")


def audio_transport_available() -> bool:
    return _go2rtc_streams_url() is not None


def _warn_reconciliation_failure(action: str, error: Exception) -> None:
    # Request errors can contain the fully encoded source URL, including its
    # access token. Log only the operation and exception type.
    logger.warning(
        "Could not %s normalized broadcast audio streams (%s)",
        action,
        type(error).__name__,
    )


def reconcile_audio_sources(sources: Iterable[BroadcastAudioSource]) -> None:
    """Best-effort synchronization of independent sources into go2rtc.

    Source URLs remain server-side. go2rtc receives an AAC-transcoding FFmpeg
    source and browser clients receive only the corresponding opaque stream
    name. The raw source remains configured separately for recording and the
    compatibility relay.
    """

    streams_url = _go2rtc_streams_url()
    if streams_url is None:
        return

    desired: dict[str, str] = {}
    for source in sources:
        source_url = _http_source_url(source)
        stream_name = audio_stream_name(source)
        if source_url is not None and stream_name is not None:
            desired[stream_name] = f"ffmpeg:{source_url}#audio=aac"

    try:
        response = requests.get(streams_url, timeout=GO2RTC_REQUEST_TIMEOUT)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise TypeError("go2rtc streams response is not an object")
        existing = {name for name in payload if isinstance(name, str)}
    except (requests.RequestException, TypeError, ValueError) as error:
        _warn_reconciliation_failure("inspect", error)
        return

    registration_failed = False
    for stream_name, source in desired.items():
        if stream_name in existing:
            continue
        try:
            response = requests.put(
                streams_url,
                params={"name": stream_name, "src": source},
                timeout=GO2RTC_REQUEST_TIMEOUT,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            registration_failed = True
            _warn_reconciliation_failure("register", error)

    # Keep an old working source if any replacement failed. Once every desired
    # source exists, remove only streams in CSpot's private namespace.
    if registration_failed:
        return
    stale = sorted(
        name
        for name in existing - desired.keys()
        if name.startswith(GO2RTC_AUDIO_STREAM_PREFIX)
    )
    for stream_name in stale:
        try:
            response = requests.delete(
                streams_url,
                params={"src": stream_name},
                timeout=GO2RTC_REQUEST_TIMEOUT,
            )
            response.raise_for_status()
        except requests.RequestException as error:
            _warn_reconciliation_failure("remove stale", error)
