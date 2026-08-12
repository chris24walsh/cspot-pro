import json
from datetime import UTC, datetime
from pathlib import Path

import requests
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.broadcast.models import BroadcastRecording, BroadcastViewerSettings
from app.modules.broadcast.recording import (
    pause_recording,
    resume_recording,
    start_recording,
    stop_recording,
)
from app.modules.broadcast.schemas import (
    BroadcastRecordingRead,
    BroadcastRecordingStart,
    BroadcastViewerSettingsRead,
    BroadcastViewerSettingsUpdate,
    ManualLivestreamUpdate,
)
from app.modules.broadcast.settings import (
    audio_sources,
    camera_sources,
    effective_audio_source,
    selected_audio_url,
)
from app.modules.identity.auth import (
    CurrentUser,
    list_permissions,
    require_any_permission,
    require_permission,
)
from app.modules.identity.models import User
from app.modules.presentation.models import PresentationPosition, PresentationSession

router = APIRouter()


def recording_read(recording: BroadcastRecording) -> BroadcastRecordingRead:
    try:
        timeline = json.loads(recording.timeline_json or "[]")
    except json.JSONDecodeError:
        timeline = []
    return BroadcastRecordingRead(
        id=recording.id,
        plan_id=recording.plan_id,
        plan_item_id=recording.plan_item_id,
        title=recording.title,
        status=recording.status,
        media_kind=recording.media_kind,
        content_type=recording.content_type,
        size_bytes=recording.size_bytes,
        duration_seconds=recording.duration_seconds,
        recorded_at=recording.recorded_at,
        started_at=recording.started_at,
        ended_at=recording.ended_at,
        pending_stop_at=recording.pending_stop_at,
        pending_stop_reason=recording.pending_stop_reason,
        end_reason=recording.end_reason,
        timeline=timeline if isinstance(timeline, list) else [],
    )


@router.get("/recordings", response_model=list[BroadcastRecordingRead])
def list_recordings(
    _current_user: User = Depends(
        require_any_permission("plans:read", "broadcast:use", "presentation:use")
    ),
    session: Session = Depends(get_session),
) -> list[BroadcastRecordingRead]:
    recordings = session.scalars(
        select(BroadcastRecording).order_by(BroadcastRecording.recorded_at.desc())
    ).all()
    return [recording_read(recording) for recording in recordings]


@router.post("/recordings/start", response_model=BroadcastRecordingRead)
def manually_start_recording(
    payload: BroadcastRecordingStart,
    current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> BroadcastRecordingRead:
    try:
        recording = start_recording(session, payload.plan_id, payload.plan_item_id, current_user.id)
    except RuntimeError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    return recording_read(recording)


@router.post("/recordings/stop", response_model=BroadcastRecordingRead | None)
def manually_stop_recording(
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> BroadcastRecordingRead | None:
    recording = stop_recording(session)
    return recording_read(recording) if recording else None


@router.post("/recordings/pause", response_model=BroadcastRecordingRead | None)
def manually_pause_recording(
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> BroadcastRecordingRead | None:
    recording = pause_recording(session)
    return recording_read(recording) if recording else None


@router.post("/recordings/resume", response_model=BroadcastRecordingRead | None)
def manually_resume_recording(
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> BroadcastRecordingRead | None:
    recording = resume_recording(session)
    return recording_read(recording) if recording else None


@router.delete("/recordings/{recording_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recording(
    recording_id: str,
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> Response:
    recording = session.get(BroadcastRecording, recording_id)
    if not recording:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    if recording.status in {"recording", "paused"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Stop recording first")
    paths = {recording.file_path, recording.audio_file_path}
    session.delete(recording)
    session.commit()
    for value in paths:
        if value:
            Path(value).unlink(missing_ok=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/recordings/{recording_id}/audio")
def recording_audio(
    recording_id: str,
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> FileResponse:
    recording = session.get(BroadcastRecording, recording_id)
    path = Path(recording.audio_file_path or recording.file_path) if recording else None
    if not recording or not path or not path.is_file() or recording.status != "ready":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    return FileResponse(
        path, media_type=recording.content_type or "audio/webm", filename=recording.file_name
    )


def viewer_settings(session: Session) -> BroadcastViewerSettings:
    settings = session.scalar(select(BroadcastViewerSettings).limit(1))
    if settings is None:
        settings = BroadcastViewerSettings(
            stream_title="Sunday Service",
            stream_description="Join us online for worship, prayer, Scripture, and teaching.",
            pre_service_minutes=60,
            starting_soon_message="Our service will begin shortly",
            offline_message="No service is streaming right now",
        )
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


def settings_read(
    settings: BroadcastViewerSettings, *, can_view_admin_test: bool = True
) -> BroadcastViewerSettingsRead:
    sources = camera_sources(settings)
    independent_sources = audio_sources(settings)
    source_ids = {source.id for source in sources}
    active_camera_id = (
        settings.active_camera_id
        if settings.active_camera_id in source_ids
        else (sources[0].id if sources else None)
    )
    manual_live_audience = settings.manual_live_audience or "off"
    if manual_live_audience == "admins" and not can_view_admin_test:
        manual_live_audience = "off"
    return BroadcastViewerSettingsRead(
        stream_title=settings.stream_title,
        stream_description=settings.stream_description,
        camera_url=settings.camera_url,
        camera_sources=sources,
        audio_sources=independent_sources,
        active_camera_id=active_camera_id,
        camera_cycle_seconds=settings.camera_cycle_seconds or 0,
        camera_cycle_started_at=settings.camera_cycle_started_at,
        camera_fade_ms=settings.camera_fade_ms or 0,
        live_audio_url=settings.live_audio_url,
        live_audio_source=effective_audio_source(settings, sources, independent_sources),
        manual_live_audience=manual_live_audience,
        mixer_name=settings.mixer_name,
        mixer_protocol=settings.mixer_protocol or "none",
        mixer_control_url=settings.mixer_control_url,
        mixer_notes=settings.mixer_notes,
        slide_delay_ms=settings.slide_delay_ms or 0,
        auto_record_sermons=settings.auto_record_sermons,
        recording_grace_seconds=settings.recording_grace_seconds or 0,
        pre_service_audio_url=settings.pre_service_audio_url,
        pre_service_minutes=settings.pre_service_minutes,
        starting_soon_message=settings.starting_soon_message,
        offline_message=settings.offline_message,
    )


def live_output_exists(session: Session) -> bool:
    now = int(datetime.now(UTC).timestamp() * 1000)
    positions = session.scalars(
        select(PresentationPosition)
        .join(PresentationSession, PresentationSession.id == PresentationPosition.session_id)
        .where(
            PresentationSession.status == "live",
            PresentationSession.ended_at.is_(None),
        )
        .order_by(PresentationPosition.updated_at.desc())
    ).all()
    for position in positions:
        try:
            payload = json.loads(position.payload_json or "{}")
        except json.JSONDecodeError:
            continue
        heartbeat = payload.get("output_heartbeat_at") if isinstance(payload, dict) else None
        owner_id = payload.get("output_owner_id") if isinstance(payload, dict) else None
        explicitly_active = payload.get("output_active") is True
        legacy_heartbeat_active = bool(
            "output_active" not in payload
            and isinstance(heartbeat, int)
            and now - heartbeat < 7000
        )
        if isinstance(owner_id, str) and (explicitly_active or legacy_heartbeat_active):
            return True
    return False


@router.get("/viewer-settings", response_model=BroadcastViewerSettingsRead)
def get_viewer_settings(
    current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> BroadcastViewerSettingsRead:
    can_view_admin_test = "users:manage" in list_permissions(session, current_user.id)
    return settings_read(
        viewer_settings(session), can_view_admin_test=can_view_admin_test
    )


@router.patch("/manual-live", response_model=BroadcastViewerSettingsRead)
def update_manual_livestream(
    payload: ManualLivestreamUpdate,
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> BroadcastViewerSettingsRead:
    settings = viewer_settings(session)
    settings.manual_live_audience = payload.audience
    session.commit()
    session.refresh(settings)
    return settings_read(settings)


@router.get("/live-audio")
def live_audio(
    current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> StreamingResponse:
    settings = viewer_settings(session)
    manual_audience = settings.manual_live_audience or "off"
    manual_live_visible = manual_audience == "public" or (
        manual_audience == "admins"
        and "users:manage" in list_permissions(session, current_user.id)
    )
    if not live_output_exists(session) and not manual_live_visible:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Live audio is available only while the livestream is running",
        )
    source_url = selected_audio_url(settings)
    if not source_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Live audio is not configured",
        )
    try:
        upstream = requests.get(source_url, stream=True, timeout=(5, None))
        upstream.raise_for_status()
    except requests.RequestException as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The live audio source is unavailable",
        ) from error

    def audio_chunks():
        try:
            # Keep the relay responsive for live speech. A 32 KiB buffer is
            # roughly four seconds of 64 kbps MP3 audio before proxy overhead.
            yield from upstream.iter_content(chunk_size=2 * 1024)
        finally:
            upstream.close()

    return StreamingResponse(
        audio_chunks(),
        media_type=upstream.headers.get("content-type", "audio/mpeg").split(";", 1)[0],
        headers={"Cache-Control": "no-store"},
    )


@router.get("/audio-sources/{source_id}/test")
def test_audio_source(
    source_id: str,
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    source = next(
        (candidate for candidate in audio_sources(viewer_settings(session)) if candidate.id == source_id),
        None,
    )
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audio source not found")
    try:
        upstream = requests.get(source.url, stream=True, timeout=(5, None))
        upstream.raise_for_status()
    except requests.RequestException as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The audio source is unavailable",
        ) from error

    def audio_chunks():
        try:
            yield from upstream.iter_content(chunk_size=2 * 1024)
        finally:
            upstream.close()

    return StreamingResponse(
        audio_chunks(),
        media_type=upstream.headers.get("content-type", "audio/mpeg").split(";", 1)[0],
        headers={"Cache-Control": "no-store"},
    )


@router.patch("/viewer-settings", response_model=BroadcastViewerSettingsRead)
def update_viewer_settings(
    payload: BroadcastViewerSettingsUpdate,
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> BroadcastViewerSettingsRead:
    settings = viewer_settings(session)
    updates = payload.model_dump(exclude_unset=True)
    camera_source_payload = updates.pop("camera_sources", ...)
    audio_source_payload = updates.pop("audio_sources", ...)
    if camera_source_payload is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="camera_sources cannot be empty",
        )
    if camera_source_payload is not ...:
        updates.pop("camera_url", None)
        source_ids = [source["id"] for source in camera_source_payload]
        if len(source_ids) != len(set(source_ids)):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Camera source IDs must be unique",
            )
        settings.camera_sources_json = json.dumps(camera_source_payload, separators=(",", ":"))
        settings.camera_url = camera_source_payload[0]["url"] if camera_source_payload else None

    if audio_source_payload is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="audio_sources cannot be empty",
        )
    if audio_source_payload is not ...:
        audio_ids = [source["id"] for source in audio_source_payload]
        if len(audio_ids) != len(set(audio_ids)):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Audio source IDs must be unique",
            )
        settings.audio_sources_json = json.dumps(audio_source_payload, separators=(",", ":"))

    sources = camera_sources(settings)
    independent_sources = audio_sources(settings)
    source_ids = {source.id for source in sources}
    audio_ids = {source.id for source in independent_sources}
    if source_ids & audio_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Camera and audio source IDs must be unique",
        )
    requested_camera_id = updates.get("active_camera_id", settings.active_camera_id)
    if requested_camera_id and requested_camera_id not in source_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The selected camera is not configured",
        )
    requested_audio_source = updates.get(
        "live_audio_source",
        effective_audio_source(settings, sources, independent_sources),
    )
    if requested_audio_source not in {"none", *source_ids, *audio_ids}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The selected live audio source is not configured",
        )
    selected_independent = next(
        (source for source in independent_sources if source.id == requested_audio_source),
        None,
    )
    updates["live_audio_url"] = selected_independent.url if selected_independent else None
    requested_mixer_protocol = updates.get("mixer_protocol", settings.mixer_protocol or "none")
    if requested_mixer_protocol not in {"none", "web", "bridge", "audio-only"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The selected mixer integration type is not supported",
        )

    if "active_camera_id" in updates or "camera_cycle_seconds" in updates or camera_source_payload is not ...:
        settings.camera_cycle_started_at = datetime.now(UTC)

    for field, value in updates.items():
        if (
            field
            in {
                "auto_record_sermons",
                "recording_grace_seconds",
                "stream_title",
                "pre_service_minutes",
                "starting_soon_message",
                "offline_message",
            }
            and value is None
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{field} cannot be empty"
            )
        if isinstance(value, str):
            value = value.strip()
            if not value and field in {"stream_title", "starting_soon_message", "offline_message"}:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"{field} cannot be empty",
                )
            value = value or None
        setattr(settings, field, value)

    if sources and settings.active_camera_id not in source_ids:
        settings.active_camera_id = sources[0].id
    if not sources:
        settings.active_camera_id = None
    session.commit()
    session.refresh(settings)
    return settings_read(settings)
