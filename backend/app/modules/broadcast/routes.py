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
)
from app.modules.identity.auth import CurrentUser, require_any_permission, require_permission
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
        timeline=timeline if isinstance(timeline, list) else [],
    )


@router.get("/recordings", response_model=list[BroadcastRecordingRead])
def list_recordings(
    _current_user: User = Depends(require_any_permission("broadcast:use", "presentation:use")),
    session: Session = Depends(get_session),
) -> list[BroadcastRecordingRead]:
    recordings = session.scalars(
        select(BroadcastRecording).order_by(BroadcastRecording.recorded_at.desc())
    ).all()
    return [recording_read(recording) for recording in recordings]


@router.post("/recordings/start", response_model=BroadcastRecordingRead)
def manually_start_recording(
    payload: BroadcastRecordingStart,
    current_user: User = Depends(require_any_permission("broadcast:use", "presentation:use")),
    session: Session = Depends(get_session),
) -> BroadcastRecordingRead:
    try:
        recording = start_recording(session, payload.plan_id, payload.plan_item_id, current_user.id)
    except RuntimeError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    return recording_read(recording)


@router.post("/recordings/stop", response_model=BroadcastRecordingRead | None)
def manually_stop_recording(
    _current_user: User = Depends(require_any_permission("broadcast:use", "presentation:use")),
    session: Session = Depends(get_session),
) -> BroadcastRecordingRead | None:
    recording = stop_recording(session)
    return recording_read(recording) if recording else None


@router.post("/recordings/pause", response_model=BroadcastRecordingRead | None)
def manually_pause_recording(
    _current_user: User = Depends(require_any_permission("broadcast:use", "presentation:use")),
    session: Session = Depends(get_session),
) -> BroadcastRecordingRead | None:
    recording = pause_recording(session)
    return recording_read(recording) if recording else None


@router.post("/recordings/resume", response_model=BroadcastRecordingRead | None)
def manually_resume_recording(
    _current_user: User = Depends(require_any_permission("broadcast:use", "presentation:use")),
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


def settings_read(settings: BroadcastViewerSettings) -> BroadcastViewerSettingsRead:
    return BroadcastViewerSettingsRead(
        stream_title=settings.stream_title,
        stream_description=settings.stream_description,
        camera_url=settings.camera_url,
        live_audio_url=settings.live_audio_url,
        auto_record_sermons=settings.auto_record_sermons,
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
        if isinstance(heartbeat, int) and isinstance(owner_id, str) and now - heartbeat < 7000:
            return True
    return False


@router.get("/viewer-settings", response_model=BroadcastViewerSettingsRead)
def get_viewer_settings(
    _current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> BroadcastViewerSettingsRead:
    return settings_read(viewer_settings(session))


@router.get("/live-audio")
def live_audio(
    _current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> StreamingResponse:
    if not live_output_exists(session):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Live audio is available only while presentation output is running",
        )
    source_url = viewer_settings(session).live_audio_url
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
            yield from upstream.iter_content(chunk_size=32 * 1024)
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
    for field, value in payload.model_dump(exclude_unset=True).items():
        if (
            field
            in {
                "auto_record_sermons",
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
    session.commit()
    session.refresh(settings)
    return settings_read(settings)
