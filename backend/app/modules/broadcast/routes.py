import mimetypes
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_session
from app.modules.broadcast.models import BroadcastRecording
from app.modules.broadcast.obs_client import obs_status, run_obs_action
from app.modules.broadcast.schemas import (
    BroadcastRecordingRead,
    ObsActionRead,
    ObsStatusRead,
    RecordingScanRead,
)
from app.modules.identity.auth import require_permission
from app.modules.identity.models import User

router = APIRouter()

VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".mkv", ".webm"}
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | {".mp3", ".wav", ".m4a"}


def _recordings_root() -> Path:
    if not settings.obs_recordings_dir:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OBS_RECORDINGS_DIR must be configured before recordings can be served.",
        )
    return Path(settings.obs_recordings_dir).expanduser().resolve()


def _audio_root() -> Path:
    root = Path(settings.obs_audio_cache_dir or settings.obs_recordings_dir or "").expanduser().resolve()
    if not str(root):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OBS_AUDIO_CACHE_DIR or OBS_RECORDINGS_DIR must be configured before MP3 audio can be created.",
        )
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_recording_path(path: str | Path) -> Path:
    root = _recordings_root()
    resolved = Path(path).expanduser().resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Recording path is outside OBS_RECORDINGS_DIR.",
        ) from exc
    return resolved


def _content_type(path: Path) -> str | None:
    content_type, _encoding = mimetypes.guess_type(path.name)
    if content_type:
        return content_type
    if path.suffix.lower() == ".mkv":
        return "video/x-matroska"
    return None


def _title_from_file(path: Path) -> str:
    return path.stem.replace("_", " ").replace("-", " ").strip() or path.name


def _to_read(recording: BroadcastRecording) -> BroadcastRecordingRead:
    return BroadcastRecordingRead(
        id=recording.id,
        plan_id=recording.plan_id,
        plan_item_id=recording.plan_item_id,
        title=recording.title,
        source=recording.source,
        media_kind=recording.media_kind,
        status=recording.status,
        file_name=recording.file_name,
        content_type=recording.content_type,
        size_bytes=recording.size_bytes,
        duration_seconds=recording.duration_seconds,
        has_audio=bool(recording.audio_file_path and Path(recording.audio_file_path).exists()),
        recorded_at=recording.recorded_at.isoformat() if recording.recorded_at else None,
        created_at=recording.created_at.isoformat(),
        updated_at=recording.updated_at.isoformat(),
    )


def _register_recording(
    session: Session,
    path: str | Path,
    current_user: User | None,
) -> BroadcastRecording | None:
    if not settings.obs_recordings_dir:
        return None

    safe_path = _safe_recording_path(path)
    if not safe_path.exists() or safe_path.suffix.lower() not in MEDIA_EXTENSIONS:
        return None

    existing = session.scalar(
        select(BroadcastRecording).where(BroadcastRecording.file_path == str(safe_path))
    )
    stat = safe_path.stat()
    if existing:
        existing.size_bytes = stat.st_size
        existing.status = "ready" if safe_path.exists() else "missing"
        existing.content_type = _content_type(safe_path)
        return existing

    recording = BroadcastRecording(
        title=_title_from_file(safe_path),
        source="obs",
        media_kind="video" if safe_path.suffix.lower() in VIDEO_EXTENSIONS else "audio",
        status="ready",
        file_path=str(safe_path),
        file_name=safe_path.name,
        content_type=_content_type(safe_path),
        size_bytes=stat.st_size,
        duration_seconds=None,
        created_by_user_id=current_user.id if current_user else None,
        recorded_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
    )
    session.add(recording)
    session.flush()
    return recording


def _get_recording(session: Session, recording_id: str) -> BroadcastRecording:
    recording = session.get(BroadcastRecording, recording_id)
    if not recording:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found.")
    return recording


@router.get("/obs/status", response_model=ObsStatusRead)
def get_obs_status(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsStatusRead:
    return obs_status()


@router.post("/obs/recording/start", response_model=ObsActionRead)
def start_obs_recording(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        status = client.get_record_status()
        if getattr(status, "output_active", False):
            return getattr(status, "output_path", None)
        response = client.start_record()
        return getattr(response, "output_path", None)

    status, output_path = run_obs_action("start recording", operation)
    return ObsActionRead(ok=True, action="start_recording", status=status, output_path=output_path)


@router.post("/obs/recording/stop", response_model=ObsActionRead)
def stop_obs_recording(
    current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        status = client.get_record_status()
        if not getattr(status, "output_active", False):
            return getattr(status, "output_path", None)
        response = client.stop_record()
        return getattr(response, "output_path", None)

    status, output_path = run_obs_action("stop recording", operation)
    if output_path:
        _register_recording(session, output_path, current_user)
        session.commit()
    return ObsActionRead(ok=True, action="stop_recording", status=status, output_path=output_path)


@router.post("/obs/streaming/start", response_model=ObsActionRead)
def start_obs_streaming(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        status = client.get_stream_status()
        if not getattr(status, "output_active", False):
            client.start_stream()
        return None

    status, output_path = run_obs_action("start streaming", operation)
    return ObsActionRead(ok=True, action="start_streaming", status=status, output_path=output_path)


@router.post("/obs/streaming/stop", response_model=ObsActionRead)
def stop_obs_streaming(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        status = client.get_stream_status()
        if getattr(status, "output_active", False):
            client.stop_stream()
        return None

    status, output_path = run_obs_action("stop streaming", operation)
    return ObsActionRead(ok=True, action="stop_streaming", status=status, output_path=output_path)


@router.post("/obs/virtual-camera/start", response_model=ObsActionRead)
def start_obs_virtual_camera(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        try:
            status = client.get_virtual_cam_status()
            if getattr(status, "output_active", False):
                return None
        except Exception:
            pass
        client.start_virtual_cam()
        return None

    status, output_path = run_obs_action("start virtual camera", operation)
    return ObsActionRead(ok=True, action="start_virtual_camera", status=status, output_path=output_path)


@router.post("/obs/virtual-camera/stop", response_model=ObsActionRead)
def stop_obs_virtual_camera(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        try:
            status = client.get_virtual_cam_status()
            if not getattr(status, "output_active", False):
                return None
        except Exception:
            pass
        client.stop_virtual_cam()
        return None

    status, output_path = run_obs_action("stop virtual camera", operation)
    return ObsActionRead(ok=True, action="stop_virtual_camera", status=status, output_path=output_path)


@router.get("/recordings", response_model=list[BroadcastRecordingRead])
def list_recordings(
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> list[BroadcastRecordingRead]:
    recordings = session.scalars(
        select(BroadcastRecording).order_by(
            BroadcastRecording.recorded_at.desc().nullslast(),
            BroadcastRecording.created_at.desc(),
        )
    ).all()
    return [_to_read(recording) for recording in recordings]


@router.post("/recordings/scan", response_model=RecordingScanRead)
def scan_recordings(
    current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> RecordingScanRead:
    root = _recordings_root()
    root.mkdir(parents=True, exist_ok=True)
    added = 0
    for path in sorted(root.rglob("*"), key=lambda found: found.stat().st_mtime, reverse=True):
        if not path.is_file() or path.suffix.lower() not in MEDIA_EXTENSIONS:
            continue
        before = session.scalar(
            select(BroadcastRecording).where(BroadcastRecording.file_path == str(path.resolve()))
        )
        _register_recording(session, path, current_user)
        if before is None:
            added += 1
    session.commit()
    recordings = session.scalars(
        select(BroadcastRecording).order_by(
            BroadcastRecording.recorded_at.desc().nullslast(),
            BroadcastRecording.created_at.desc(),
        )
    ).all()
    return RecordingScanRead(added=added, recordings=[_to_read(recording) for recording in recordings])


@router.get("/recordings/{recording_id}/video")
def stream_recording_video(
    recording_id: str,
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> FileResponse:
    recording = _get_recording(session, recording_id)
    path = _safe_recording_path(recording.file_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording file is missing.")
    return FileResponse(path, media_type=recording.content_type or _content_type(path), filename=path.name)


@router.get("/recordings/{recording_id}/download")
def download_recording_video(
    recording_id: str,
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> FileResponse:
    recording = _get_recording(session, recording_id)
    path = _safe_recording_path(recording.file_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording file is missing.")
    return FileResponse(
        path,
        media_type=recording.content_type or _content_type(path),
        filename=path.name,
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
    )


@router.post("/recordings/{recording_id}/audio", response_model=BroadcastRecordingRead)
def create_recording_audio(
    recording_id: str,
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> BroadcastRecordingRead:
    recording = _get_recording(session, recording_id)
    source_path = _safe_recording_path(recording.file_path)
    if not source_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording file is missing.")
    if source_path.suffix.lower() == ".mp3":
        recording.audio_file_path = str(source_path)
        session.commit()
        session.refresh(recording)
        return _to_read(recording)

    audio_path = _audio_root() / f"{recording.id}.mp3"
    if not audio_path.exists():
        try:
            subprocess.run(
                [
                    settings.ffmpeg_path,
                    "-y",
                    "-i",
                    str(source_path),
                    "-vn",
                    "-codec:a",
                    "libmp3lame",
                    "-q:a",
                    "2",
                    str(audio_path),
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=600,
            )
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="ffmpeg is not installed in the API container.",
            ) from exc
        except subprocess.CalledProcessError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Could not create MP3 audio: {exc.stderr[-800:]}",
            ) from exc

    recording.audio_file_path = str(audio_path)
    session.commit()
    session.refresh(recording)
    return _to_read(recording)


@router.get("/recordings/{recording_id}/audio")
def stream_recording_audio(
    recording_id: str,
    _current_user: User = Depends(require_permission("broadcast:use")),
    session: Session = Depends(get_session),
) -> FileResponse:
    recording = _get_recording(session, recording_id)
    if not recording.audio_file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MP3 audio has not been created yet.")
    path = Path(recording.audio_file_path).expanduser().resolve()
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MP3 audio file is missing.")
    return FileResponse(path, media_type="audio/mpeg", filename=path.name)
