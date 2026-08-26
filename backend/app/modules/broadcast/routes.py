import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated
from urllib.parse import parse_qs, urlsplit

import requests
from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.broadcast.audio_mix import ffmpeg_live_mix_command, live_audio_mix_inputs
from app.modules.broadcast.audio_scenes import activate_audio_scene
from app.modules.broadcast.live_audio import (
    allocate_control_port,
    register_live_audio_control,
    unregister_live_audio_control,
    update_live_audio_controls,
)
from app.modules.broadcast.models import BroadcastRecording, BroadcastViewerSettings
from app.modules.broadcast.recording import (
    pause_recording,
    reconfigure_active_recording,
    resume_recording,
    start_recording,
    stop_recording,
)
from app.modules.broadcast.schemas import (
    BroadcastAudioSceneChannel,
    BroadcastAudioSourceRead,
    BroadcastRecordingRead,
    BroadcastRecordingStart,
    BroadcastViewerSettingsRead,
    BroadcastViewerSettingsUpdate,
    ManualLivestreamUpdate,
)
from app.modules.broadcast.settings import (
    audio_scenes,
    audio_sources,
    camera_sources,
    effective_audio_source,
)
from app.modules.broadcast.transport import (
    audio_stream_name,
    audio_transport_available,
    camera_stream_name,
    reconcile_audio_sources,
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
    settings: BroadcastViewerSettings,
    *,
    can_view_admin_test: bool = True,
    include_audio_source_urls: bool = True,
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
    selected_independent_audio = next(
        (
            source
            for source in independent_sources
            if source.id == effective_audio_source(settings, sources, independent_sources)
        ),
        None,
    )
    return BroadcastViewerSettingsRead(
        stream_title=settings.stream_title,
        stream_description=settings.stream_description,
        camera_url=settings.camera_url,
        camera_sources=sources,
        audio_sources=[
            BroadcastAudioSourceRead(
                id=source.id,
                label=source.label,
                url=source.url if include_audio_source_urls else None,
                stream_name=(
                    audio_stream_name(source)
                    if include_audio_source_urls and audio_transport_available()
                    else None
                ),
                gain_db=source.gain_db,
                mix_enabled=source.mix_enabled,
            )
            for source in independent_sources
        ],
        audio_scenes=audio_scenes(settings),
        active_audio_scene=settings.active_audio_scene or "pastor",
        audio_scene_automation=settings.audio_scene_automation is not False,
        active_camera_id=active_camera_id,
        camera_cycle_seconds=settings.camera_cycle_seconds or 0,
        camera_cycle_started_at=settings.camera_cycle_started_at,
        camera_fade_ms=settings.camera_fade_ms or 0,
        live_audio_url=settings.live_audio_url if include_audio_source_urls else None,
        live_audio_source=effective_audio_source(settings, sources, independent_sources),
        live_audio_stream_name=(
            audio_stream_name(selected_independent_audio)
            if selected_independent_audio is not None and audio_transport_available()
            else None
        ),
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
    permissions = set(list_permissions(session, current_user.id))
    can_view_admin_test = "users:manage" in permissions
    can_manage_broadcast = bool(
        permissions.intersection({"broadcast:use", "users:manage"})
    )
    return settings_read(
        viewer_settings(session),
        can_view_admin_test=can_view_admin_test,
        include_audio_source_urls=can_manage_broadcast,
    )


@router.get("/playback-authorized", status_code=status.HTTP_204_NO_CONTENT)
def playback_authorized(
    current_user: CurrentUser,
    session: Session = Depends(get_session),
    playback_source: Annotated[
        str | None, Header(alias="X-CSpot-Playback-Source")
    ] = None,
    playback_uri: Annotated[
        str | None, Header(alias="X-CSpot-Playback-URI")
    ] = None,
) -> Response:
    permissions = set(list_permissions(session, current_user.id))
    settings = viewer_settings(session)
    can_manage = bool(permissions.intersection({"broadcast:use", "users:manage"}))
    manual_audience = settings.manual_live_audience or "off"
    manually_visible = manual_audience == "public" or (
        manual_audience == "admins" and "users:manage" in permissions
    )
    if not can_manage and not manually_visible and not live_output_exists(session):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Livestream playback is not currently available",
        )

    # HLS child playlists and segments carry a short-lived session ID instead
    # of the source name. Their session can only be created by an authorized
    # request to a source-checked top-level playlist.
    is_hls_session_request = bool(
        playback_uri and "/camera/api/hls/" in playback_uri.split("?", 1)[0]
    )
    if not is_hls_session_request:
        requested_source = playback_source
        if not requested_source and playback_uri:
            requested_source = (
                parse_qs(urlsplit(playback_uri).query).get("src") or [None]
            )[0]
        allowed_sources = {
            name
            for source in camera_sources(settings)
            if (name := camera_stream_name(source)) is not None
        }
        independent_sources = audio_sources(settings)
        if can_manage:
            allowed_sources.update(
                name
                for source in independent_sources
                if (name := audio_stream_name(source)) is not None
            )
        else:
            selected_source_id = effective_audio_source(
                settings,
                camera_sources(settings),
                independent_sources,
            )
            selected_source = next(
                (
                    source
                    for source in independent_sources
                    if source.id == selected_source_id
                ),
                None,
            )
            if selected_source and (name := audio_stream_name(selected_source)):
                allowed_sources.add(name)
        if requested_source not in allowed_sources:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Livestream source is not configured",
            )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    inputs = live_audio_mix_inputs(settings)
    if not inputs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Live audio is not configured",
        )
    try:
        control_port = allocate_control_port()
        process = subprocess.Popen(
            ffmpeg_live_mix_command(inputs, control_port),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
    except OSError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The live audio mixer is unavailable",
        ) from error

    control = register_live_audio_control(control_port, inputs)

    def audio_chunks():
        try:
            if process.stdout is None:
                return
            while chunk := process.stdout.read(2 * 1024):
                yield chunk
        finally:
            unregister_live_audio_control(control)
            if process.stdout:
                process.stdout.close()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()

    return StreamingResponse(
        audio_chunks(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/audio-sources/{source_id}/test")
def test_audio_source(
    source_id: str,
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> StreamingResponse:
    source = next(
        (
            candidate
            for candidate in audio_sources(viewer_settings(session))
            if candidate.id == source_id
        ),
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
    audio_scene_payload = updates.pop("audio_scenes", ...)
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

    if audio_scene_payload is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="audio_scenes cannot be empty",
        )
    if audio_scene_payload is not ...:
        scene_ids = [scene["id"] for scene in audio_scene_payload]
        if len(scene_ids) != len(set(scene_ids)):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Audio scene IDs must be unique",
            )
        settings.audio_scenes_json = json.dumps(audio_scene_payload, separators=(",", ":"))

    if audio_source_payload is not ... and audio_scene_payload is ...:
        current_scene = settings.active_audio_scene or "pastor"
        scenes = audio_scenes(settings)
        for scene in scenes:
            if scene.id != current_scene:
                continue
            scene.channels = {
                source["id"]: BroadcastAudioSceneChannel(
                    gain_db=source.get("gain_db", 0),
                    enabled=source.get("mix_enabled", True),
                )
                for source in audio_source_payload
            }
        settings.audio_scenes_json = json.dumps(
            [scene.model_dump() for scene in scenes], separators=(",", ":")
        )

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
    if requested_audio_source not in {"none", "mix", *source_ids, *audio_ids}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The selected live audio source is not configured",
        )
    if requested_audio_source == "mix" and not any(
        source.mix_enabled for source in independent_sources
    ):
        requested_audio_source = "none"
    updates["live_audio_source"] = requested_audio_source
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

    camera_cycle_changed = (
        "active_camera_id" in updates
        or "camera_cycle_seconds" in updates
        or camera_source_payload is not ...
    )
    if camera_cycle_changed:
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
    requested_scene = payload.active_audio_scene
    if requested_scene and not activate_audio_scene(session, settings, requested_scene):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The selected audio scene is not configured",
        )
    else:
        update_live_audio_controls(live_audio_mix_inputs(settings))
        reconfigure_active_recording(session)
    result = settings_read(settings)
    reconcile_audio_sources(independent_sources)
    return result
