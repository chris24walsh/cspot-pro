"""Scoped invitations and WHIP/WHEP signaling for travelling speakers.

Only server-selected gateway endpoints are reachable here. Invitation secrets stay
in the URL fragment and are sent in Authorization headers, never playback URLs.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import parse_qs, urljoin, urlsplit

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings as config
from app.core.database import get_session
from app.modules.broadcast.contribution_state import (
    connected,
    stream_name,
    utc,
)
from app.modules.broadcast.models import BroadcastContribution, BroadcastViewerSettings
from app.modules.identity.auth import require_any_permission, require_permission
from app.modules.identity.models import User


def private_response(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"


router = APIRouter(dependencies=[Depends(private_response)])
operator = require_permission("broadcast:use")
Database = Annotated[Session, Depends(get_session)]
Operator = Annotated[User, Depends(operator)]
contributor = require_any_permission("broadcast:contribute", "broadcast:use")
Contributor = Annotated[User, Depends(contributor)]


class Invitation(BaseModel):
    label: str = Field(default="Remote pastor", min_length=1, max_length=120)
    hours: int = Field(default=12, ge=1, le=168)
    return_source_id: str | None = Field(default=None, max_length=80)


class Offer(BaseModel):
    sdp: str = Field(min_length=10, max_length=100000)


class Heartbeat(BaseModel):
    publisher_session: str = Field(min_length=1, max_length=160)
    connected: bool = True


class OnAir(BaseModel):
    live: bool


def gateway(method, path, *, missing_ok=False, **kwargs):
    upstream = (config.camera_proxy_upstream or "").strip()
    if not upstream:
        raise HTTPException(503, "The camera gateway is not configured")
    try:
        response = requests.request(
            method,
            urljoin(upstream.rstrip("/") + "/", path),
            timeout=(3, 15),
            **kwargs,
        )
        if not (missing_ok and response.status_code == 404):
            response.raise_for_status()
        return response
    except requests.RequestException:
        # Upstream errors may contain credentials or SDP; do not reflect them.
        raise HTTPException(502, "The media gateway could not complete the connection") from None


_gateway_probe = ("", 0.0, False)


def gateway_available():
    """Probe the module itself: a compatible version can still fail to bind ICE."""
    global _gateway_probe
    upstream = (config.camera_proxy_upstream or "").strip()
    now = time.monotonic()
    if _gateway_probe[0] == upstream and now - _gateway_probe[1] < 30:
        return _gateway_probe[2]
    available = False
    if upstream:
        try:
            response = requests.options(
                urljoin(upstream.rstrip("/") + "/", "api/webrtc"),
                timeout=(1, 2),
            )
            available = response.status_code in {200, 204}
        except requests.RequestException:
            pass
    _gateway_probe = (upstream, now, available)
    return available


def ice_servers():
    try:
        servers = json.loads(config.remote_ice_servers_json)
        if not isinstance(servers, list) or any(
            not isinstance(server, dict) or not isinstance(server.get("urls"), (str, list))
            for server in servers
        ):
            raise ValueError()
    except (ValueError, TypeError):
        raise HTTPException(503, "Remote ICE server configuration is invalid") from None
    servers = list(servers)
    if config.remote_turn_urls and config.remote_turn_secret:
        username = f"{int((datetime.now(UTC) + timedelta(hours=2)).timestamp())}:cspot"
        credential = base64.b64encode(
            hmac.new(
                config.remote_turn_secret.encode(),
                username.encode(),
                hashlib.sha1,
            ).digest()
        ).decode()
        servers.append(
            {
                "urls": config.remote_turn_urls.split(","),
                "username": username,
                "credential": credential,
            }
        )
    return servers


def relay_available(servers):
    return any(
        str(url).startswith(("turn:", "turns:"))
        for server in servers
        for url in (
            [server.get("urls")] if isinstance(server.get("urls"), str) else server.get("urls", [])
        )
    )


def guest_by_id(session, guest_id):
    guest = session.get(BroadcastContribution, guest_id)
    if not guest:
        raise HTTPException(404, "Contribution not found")
    return guest


def invited_guest(
    session: Database,
    authorization: str = Header(default=""),
):
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not 40 <= len(token) <= 100:
        raise HTTPException(401, "This invitation is invalid or has expired")
    guest = session.scalar(
        select(BroadcastContribution).where(
            BroadcastContribution.token_hash == hashlib.sha256(token.encode()).hexdigest(),
        )
    )
    validate_invitation(guest)
    return guest


def validate_invitation(guest):
    if not guest or guest.revoked_at or utc(guest.expires_at) <= datetime.now(UTC):
        raise HTTPException(401, "This invitation is invalid or has expired")


InvitedGuest = Annotated[BroadcastContribution, Depends(invited_guest)]


def broadcast_settings(session):
    from app.modules.broadcast.routes import viewer_settings

    return viewer_settings(session)


def return_source(session, source_id):
    from app.modules.broadcast.settings import audio_sources

    # Never expose the program override back to the contributor.
    sources = audio_sources(broadcast_settings(session))
    return next((s for s in sources if s.id == source_id and not s.id.startswith("guest-")), None)


def church_camera(session):
    from app.modules.broadcast.settings import camera_sources

    settings = broadcast_settings(session)
    sources = [source for source in camera_sources(settings) if not source.id.startswith("guest-")]
    return next((source for source in sources if source.id == settings.active_camera_id),
                sources[0] if sources else None)


def guest_read(session, guest):
    settings = broadcast_settings(session)
    return {
        "id": guest.id,
        "label": guest.label,
        "expires_at": guest.expires_at,
        "revoked": bool(guest.revoked_at),
        "connected": connected(guest),
        "live": bool(settings.remote_contribution_id == guest.id and connected(guest)),
        "return_source_id": guest.return_source_id,
    }


def register_stream(name, source):
    # PATCH updates in-memory sources without persisting invite-specific streams
    # into the operator's gateway configuration file.
    gateway("PATCH", "api/streams", params={"name": name, "src": source})


def prepare_streams(guest):
    raw = stream_name(guest, raw=True)
    existing = gateway("GET", "api/streams").json()
    if raw not in existing:
        # A refused local placeholder registers the destination before WHIP adds
        # its passive producer. No network camera is contacted or configured.
        register_stream(raw, "rtsp://127.0.0.1:1/awaiting-contributor")
    if stream_name(guest) not in existing:
        # Gateway API registration accepts codec presets, but rejects arbitrary
        # FFmpeg arguments. Capture supplies a steady 24 fps before publishing.
        register_stream(stream_name(guest), f"ffmpeg:{raw}#video=h264#audio=aac")


def stop_publisher(guest):
    if guest.publisher_session:
        gateway("DELETE", "api/webrtc", params={"id": guest.publisher_session}, missing_ok=True)
        guest.publisher_session = None
    guest.last_seen_at = None


def exchange(source, offer, *, publish=False):
    response = gateway(
        "POST",
        "api/webrtc",
        params={"dst" if publish else "src": source},
        data=offer.sdp,
        headers={"Content-Type": "application/sdp"},
    )
    session_id = (
        parse_qs(urlsplit(response.headers.get("Location", "")).query).get("id") or [None]
    )[0]
    if publish and (not session_id or len(session_id) > 160):
        raise HTTPException(502, "The gateway does not support managed WHIP publishing")
    return {"sdp": response.text, "publisher_session": session_id}


@router.get("")
def list_contributions(session: Database, _user: Operator):
    guests = session.scalars(
        select(BroadcastContribution)
        .where(
            BroadcastContribution.revoked_at.is_(None),
            BroadcastContribution.expires_at > datetime.now(UTC),
        )
        .order_by(BroadcastContribution.created_at.desc())
        .limit(30)
    )
    servers = ice_servers()
    return {
        "guests": [guest_read(session, guest) for guest in guests],
        "ice_servers": servers,
        "relay_available": relay_available(servers),
        "gateway_configured": bool(config.camera_proxy_upstream),
        "gateway_available": gateway_available(),
    }


@router.post("", status_code=201)
def create_invitation(payload: Invitation, session: Database, _user: Operator):
    return new_contribution(payload, session)


def new_contribution(payload: Invitation, session: Session, owner_user_id: str | None = None):
    if not config.camera_proxy_upstream:
        raise HTTPException(503, "The camera gateway is not configured")
    if not gateway_available():
        raise HTTPException(503, "The camera gateway WebRTC listener is unavailable")
    if payload.return_source_id and not return_source(session, payload.return_source_id):
        raise HTTPException(422, "Choose an existing church audio return source")
    token = secrets.token_urlsafe(32)
    guest = BroadcastContribution(
        label=payload.label.strip() or "Remote pastor",
        owner_user_id=owner_user_id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=datetime.now(UTC) + timedelta(hours=payload.hours),
        return_source_id=payload.return_source_id,
    )
    session.add(guest)
    session.commit()
    return {**guest_read(session, guest), "token": token}


@router.post("/self", status_code=201)
def start_self_contribution(session: Database, current_user: Contributor):
    # Teachers can publish their own device, but cannot invite other people or
    # select another source for return audio. Broadcast approval stays separate.
    from app.modules.broadcast.settings import audio_sources, selected_independent_audio_sources

    settings = broadcast_settings(session)
    program = next(
        (
            source
            for source in audio_sources(settings)
            if source.id == settings.mixer_program_source_id
        ),
        None,
    )
    sources = selected_independent_audio_sources(settings)
    return_source_id = program.id if program else (sources[0].id if sources else None)
    return new_contribution(
        Invitation(
            label=(current_user.name.strip() or "Service teacher")[:120],
            hours=12,
            return_source_id=return_source_id,
        ),
        session,
        owner_user_id=current_user.id,
    )


@router.delete("/self/{guest_id}")
def stop_self_contribution(guest_id: str, session: Database, current_user: Contributor):
    guest = guest_by_id(session, guest_id)
    if guest.owner_user_id != current_user.id:
        raise HTTPException(404, "Contribution not found")
    return revoke(guest_id, session, current_user)


@router.get("/guest")
def guest_status(guest: InvitedGuest, session: Database):
    servers = ice_servers()
    return {
        **guest_read(session, guest),
        "ice_servers": servers,
        "relay_available": relay_available(servers),
        "return_available": bool(return_source(session, guest.return_source_id)),
        "camera_source_id": camera.id if (camera := church_camera(session)) else None,
        "cue": current_cue(session),
    }


def current_item(session):
    from app.modules.planning.models import PlanItem

    cue = current_cue(session)
    item = session.get(PlanItem, cue["item_id"]) if cue and cue.get("item_id") else None
    if not item or cue["blanked"]:
        raise HTTPException(404, "No visible service slide")
    return cue, item


def slide_file(session, file_id):
    from app.modules.library.models import StoredFile
    from app.modules.planning.routes import plan_item_to_read

    _, item = current_item(session)
    detail = plan_item_to_read(session, item)
    if file_id not in {f.file_id for f in detail.files}:
        raise HTTPException(404, "File is not part of the current service item")
    stored = session.get(StoredFile, file_id)
    if not stored:
        raise HTTPException(404, "Slide file not found")
    return stored


@router.get("/guest/slide")
def guest_slide(_guest: InvitedGuest, session: Database):
    from app.modules.library.routes import _read_build_manifest, _render_slides
    from app.modules.music.models import Song
    from app.modules.music.routes import song_to_read
    from app.modules.planning.routes import plan_item_to_read

    cue, item = current_item(session)
    detail = plan_item_to_read(session, item)
    # Only presentation content: private teaching notes never leave this route.
    detail.teacher_notes = None
    song = session.get(Song, item.song_id) if item.song_id else None
    rendered = {}
    from app.modules.library.models import StoredFile

    for attachment in detail.files:
        if attachment.display_name.lower().endswith((".ppt", ".pptx", ".pdf", ".odp")):
            stored = session.get(StoredFile, attachment.file_id)
            if stored:
                slides = _render_slides(stored)
                metadata = _read_build_manifest(stored.id, len(slides))
                rendered[stored.id] = [
                    {
                        "index": index + 1,
                        "image_url": f"/api/v1/library/files/{stored.id}/slides/{index + 1}.png",
                        **metadata[index],
                    }
                    for index in range(len(slides))
                ]
    return {
        "cue": cue,
        "item": detail,
        "songs": [song_to_read(song)] if song else [],
        "rendered": rendered,
    }


@router.get("/guest/files/{file_id}/slides/{index}.png")
def guest_slide_image(file_id: str, index: int, _guest: InvitedGuest, session: Database):
    from app.modules.library.routes import _render_slides

    stored = slide_file(session, file_id)
    paths = _render_slides(stored)
    if not 1 <= index <= len(paths):
        raise HTTPException(404, "Slide image not found")
    return FileResponse(
        paths[index - 1], media_type="image/png", headers={"Cache-Control": "no-store"}
    )


@router.get("/guest/files/{file_id}/content")
def guest_image(file_id: str, _guest: InvitedGuest, session: Database):
    stored = slide_file(session, file_id)
    if not (stored.content_type or "").startswith("image/"):
        raise HTTPException(404, "Image not found")
    return FileResponse(
        stored.storage_path, media_type=stored.content_type, headers={"Cache-Control": "no-store"}
    )


@router.post("/guest/publish")
def publish(offer: Offer, guest: InvitedGuest, session: Database):
    # Serialize duplicate tabs/reconnects for this invitation.
    session.refresh(guest, with_for_update=True)
    validate_invitation(guest)
    if guest.publisher_session:
        stop_publisher(guest)
    prepare_streams(guest)
    result = exchange(stream_name(guest, raw=True), offer, publish=True)
    guest.publisher_session = result["publisher_session"]
    guest.last_seen_at = datetime.now(UTC)
    session.commit()
    return result


@router.post("/guest/heartbeat")
def heartbeat(payload: Heartbeat, guest: InvitedGuest, session: Database):
    session.refresh(guest, with_for_update=True)
    validate_invitation(guest)
    if payload.publisher_session != guest.publisher_session:
        raise HTTPException(409, "Another connection has replaced this device")
    guest.last_seen_at = datetime.now(UTC) if payload.connected else None
    if not payload.connected:
        settings = broadcast_settings(session)
        if settings.remote_contribution_id == guest.id:
            settings.remote_contribution_id = None
    session.commit()
    reconfigure_recording(session)
    return guest_read(session, guest)


@router.post("/guest/leave")
def leave(payload: Heartbeat, guest: InvitedGuest, session: Database):
    session.refresh(guest, with_for_update=True)
    validate_invitation(guest)
    if payload.publisher_session == guest.publisher_session:
        settings = broadcast_settings(session)
        if settings.remote_contribution_id == guest.id:
            settings.remote_contribution_id = None
        stop_publisher(guest)
        session.commit()
        reconfigure_recording(session)
    return {"ok": True}


@router.post("/guest/return")
def church_return(offer: Offer, guest: InvitedGuest, session: Database):
    source = return_source(session, guest.return_source_id)
    if not source:
        raise HTTPException(409, "No church return audio has been assigned")
    name = f"cspot-guest-return-{guest.id}"
    register_stream(name, f"ffmpeg:{source.url}#audio=opus")
    return exchange(name, offer)


@router.post("/guest/camera")
def church_camera_preview(offer: Offer, guest: InvitedGuest, session: Database):
    source = church_camera(session)
    if not source:
        raise HTTPException(409, "No church camera is configured")
    # Keep private camera URLs server-side; never return the guest's own feed.
    parsed = urlsplit(source.url)
    stream = (parse_qs(parsed.query).get("src") or [None])[0]
    if stream and "/camera/" in parsed.path:
        return exchange(stream, offer)
    name = f"cspot-guest-camera-{guest.id}"
    register_stream(name, f"ffmpeg:{source.url}#video=h264")
    return exchange(name, offer)


@router.post("/{guest_id}/preview")
def preview(guest_id: str, offer: Offer, session: Database, _user: Operator):
    guest = guest_by_id(session, guest_id)
    if not connected(guest):
        raise HTTPException(409, "The contributor is not connected")
    return exchange(stream_name(guest, raw=True), offer)


@router.post("/{guest_id}/on-air")
def on_air(guest_id: str, payload: OnAir, session: Database, _user: Operator):
    guest = guest_by_id(session, guest_id)
    session.refresh(guest, with_for_update=True)
    settings = broadcast_settings(session)
    if payload.live:
        if not connected(guest):
            raise HTTPException(409, "Wait for the contributor to connect")
        state = gateway("GET", "api/streams", params={"src": stream_name(guest, raw=True)}).json()
        if not any(p.get("bytes_recv", 0) > 0 for p in state.get("producers", [])):
            raise HTTPException(409, "The gateway is not receiving media yet; check the preview")
        settings.remote_contribution_id = guest.id
        session.flush()
    elif settings.remote_contribution_id == guest.id:
        settings.remote_contribution_id = None
    session.commit()
    reconfigure_recording(session)
    return guest_read(session, guest)


@router.delete("/{guest_id}")
def revoke(guest_id: str, session: Database, _user: Operator):
    guest = guest_by_id(session, guest_id)
    session.refresh(guest, with_for_update=True)
    # Commit revocation first: even a gateway failure must invalidate the link.
    guest.revoked_at = datetime.now(UTC)
    settings = broadcast_settings(session)
    if settings.remote_contribution_id == guest.id:
        settings.remote_contribution_id = None
    session.commit()
    reconfigure_recording(session)
    stop_publisher(guest)
    session.commit()
    return {"ok": True}


def current_cue(session):
    """Expose only the active service cue, never plan notes or the song library."""
    from app.modules.planning.models import PlanItem
    from app.modules.presentation.models import PresentationPosition, PresentationSession

    positions = session.execute(
        select(PresentationPosition, PresentationSession)
        .join(
            PresentationSession,
            PresentationPosition.session_id == PresentationSession.id,
        )
        .where(PresentationSession.status == "live")
        .order_by(
            PresentationPosition.updated_at.desc(),
        )
        .limit(5)
    )
    for position, _ in positions:
        try:
            payload = json.loads(position.payload_json or "{}")
            heartbeat_at = int(payload.get("output_heartbeat_at", 0))
        except (TypeError, ValueError):
            continue
        if heartbeat_at < int(datetime.now(UTC).timestamp() * 1000) - 30000:
            continue
        item = session.get(PlanItem, position.plan_item_id) if position.plan_item_id else None
        return {
            "title": item.title if item else "Service",
            "slide": int(payload.get("slide_offset", 0)) + 1,
            "item_id": item.id if item else None,
            "revision": int(payload.get("updated_at", 0)),
            "blanked": bool(payload.get("blanked")),
        }
    return None


def cleanup_contributions(session):
    """Remove stale publishing leases and their private gateway entries."""
    now = datetime.now(UTC)
    settings = session.scalar(select(BroadcastViewerSettings).limit(1))
    candidates = (
        select(BroadcastContribution)
        .where(
            or_(
                BroadcastContribution.expires_at <= now,
                BroadcastContribution.revoked_at.is_not(None),
                BroadcastContribution.last_seen_at < now - timedelta(seconds=25),
                BroadcastContribution.last_seen_at.is_(None),
            )
        )
        .with_for_update(skip_locked=True)
    )
    for guest in session.scalars(candidates):
        expired = bool(guest.revoked_at or utc(guest.expires_at) <= now)
        stale = not connected(guest)
        if not stale:
            continue
        if settings and settings.remote_contribution_id == guest.id:
            settings.remote_contribution_id = None
        if guest.publisher_session:
            try:
                stop_publisher(guest)
            except HTTPException:
                continue  # Keep the lease so the next maintenance pass retries.
        if expired:
            for name in (
                stream_name(guest),
                stream_name(guest, raw=True),
                f"cspot-guest-return-{guest.id}",
            ):
                # Deleting unknown names is idempotent in go2rtc.
                gateway("DELETE", "api/streams", params={"src": name})
            session.delete(guest)
    session.commit()
    reconfigure_recording(session)


def reconfigure_recording(session):
    from app.modules.broadcast.recording import reconfigure_active_recording

    reconfigure_active_recording(session)
