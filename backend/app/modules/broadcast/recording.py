import json
import signal
import subprocess
import threading
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.broadcast.models import BroadcastRecording, BroadcastViewerSettings
from app.modules.planning.models import Plan, PlanItem

RECORDING_ROOT = Path("/app/storage/recordings")


class ActiveRecording:
    def __init__(self, recording_id: str, plan_id: str, process: subprocess.Popen[bytes]):
        self.recording_id = recording_id
        self.plan_id = plan_id
        self.process = process


_lock = threading.RLock()
_active: ActiveRecording | None = None


def _source_url(session: Session) -> str | None:
    viewer = session.scalar(select(BroadcastViewerSettings).limit(1))
    camera_url = viewer.camera_url.strip() if viewer and viewer.camera_url else ""
    if not camera_url:
        return None
    if camera_url.startswith("/app/camera/"):
        if not settings.camera_proxy_upstream:
            return None
        return urljoin(settings.camera_proxy_upstream.rstrip("/") + "/", camera_url[12:])
    if camera_url.startswith(("http://", "https://", "rtsp://")):
        return camera_url
    return None


def _timeline(recording: BroadcastRecording) -> list[dict[str, object]]:
    if not recording.timeline_json:
        return []
    try:
        value = json.loads(recording.timeline_json)
        return value if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []


def start_recording(
    session: Session,
    plan_id: str,
    plan_item_id: str | None,
    created_by_user_id: str | None = None,
) -> BroadcastRecording:
    global _active
    with _lock:
        if _active:
            existing = session.get(BroadcastRecording, _active.recording_id)
            if _active.process.poll() is None and existing:
                return existing
            if existing:
                existing.status = "failed"
                existing.ended_at = datetime.now(UTC)
                session.commit()
            _active = None

        source_url = _source_url(session)
        if not source_url:
            raise RuntimeError("A recordable camera or audio stream is not configured")
        plan = session.get(Plan, plan_id)
        item = session.get(PlanItem, plan_item_id) if plan_item_id else None
        now = datetime.now(UTC)
        RECORDING_ROOT.mkdir(parents=True, exist_ok=True)
        file_name = f"sermon-{now:%Y%m%d-%H%M%S}.webm"
        file_path = RECORDING_ROOT / file_name
        recording = BroadcastRecording(
            plan_id=plan_id,
            plan_item_id=plan_item_id,
            created_by_user_id=created_by_user_id,
            title=item.title if item else f"{plan.title if plan else 'Service'} sermon",
            source="automatic-sermon",
            media_kind="audio-slides",
            status="recording",
            file_path=str(file_path),
            file_name=file_name,
            content_type="audio/webm; codecs=opus",
            audio_file_path=str(file_path),
            recorded_at=now,
            started_at=now,
            timeline_json="[]",
        )
        session.add(recording)
        session.commit()
        session.refresh(recording)
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            source_url,
            "-vn",
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-c:a",
            "libopus",
            "-b:a",
            "48k",
            str(file_path),
        ]
        try:
            process = subprocess.Popen(
                command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        except OSError as error:
            recording.status = "failed"
            recording.ended_at = datetime.now(UTC)
            session.commit()
            raise RuntimeError("Could not start the audio recorder") from error
        _active = ActiveRecording(recording.id, plan_id, process)
        return recording


def record_slide_transition(
    session: Session, plan_id: str, plan_item_id: str, slide_offset: int
) -> None:
    with _lock:
        if not _active or _active.plan_id != plan_id or _active.process.poll() is not None:
            return
        recording = session.get(BroadcastRecording, _active.recording_id)
        if not recording or not recording.started_at:
            return
        events = _timeline(recording)
        if (
            events
            and events[-1].get("plan_item_id") == plan_item_id
            and events[-1].get("slide_offset") == slide_offset
        ):
            return
        elapsed = max(0.0, (datetime.now(UTC) - recording.started_at).total_seconds())
        events.append(
            {"at": round(elapsed, 3), "plan_item_id": plan_item_id, "slide_offset": slide_offset}
        )
        recording.timeline_json = json.dumps(events, separators=(",", ":"))
        session.commit()


def stop_recording(session: Session, plan_id: str | None = None) -> BroadcastRecording | None:
    global _active
    with _lock:
        if not _active or (plan_id is not None and _active.plan_id != plan_id):
            return None
        active = _active
        _active = None
        recording = session.get(BroadcastRecording, active.recording_id)
        if active.process.poll() is None:
            active.process.send_signal(signal.SIGINT)
            try:
                active.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                active.process.terminate()
                active.process.wait(timeout=5)
        if recording:
            recording.ended_at = datetime.now(UTC)
            if recording.started_at:
                recording.duration_seconds = int(
                    (recording.ended_at - recording.started_at).total_seconds()
                )
            path = Path(recording.file_path)
            recording.size_bytes = path.stat().st_size if path.exists() else None
            recording.status = "ready" if recording.size_bytes else "failed"
            session.commit()
            session.refresh(recording)
        return recording


def sync_sermon_recording(
    session: Session,
    plan_id: str,
    plan_item_id: str | None,
    slide_offset: int,
    created_by_user_id: str | None,
) -> None:
    item = session.get(PlanItem, plan_item_id) if plan_item_id else None
    if item and item.plan_id == plan_id and item.item_type == "sermon" and item.deleted_at is None:
        try:
            start_recording(session, plan_id, item.id, created_by_user_id)
            record_slide_transition(session, plan_id, item.id, slide_offset)
        except RuntimeError:
            return
    elif _active and _active.plan_id == plan_id:
        stop_recording(session, plan_id)
