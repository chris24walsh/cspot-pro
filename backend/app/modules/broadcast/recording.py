import json
import signal
import subprocess
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.broadcast.models import BroadcastRecording, BroadcastViewerSettings
from app.modules.planning.models import PlanItem
from app.modules.presentation.models import PresentationPosition, PresentationSession

RECORDING_ROOT = Path("/app/storage/recordings")


class ActiveRecording:
    def __init__(self, recording_id: str, plan_id: str, process: subprocess.Popen[bytes]):
        self.recording_id = recording_id
        self.plan_id = plan_id
        self.process = process
        self.paused_at: datetime | None = None
        self.paused_seconds = 0.0


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


def _recording_title(now: datetime) -> str:
    try:
        local = now.astimezone(ZoneInfo(settings.app_timezone))
    except ZoneInfoNotFoundError:
        local = now
    return local.strftime("%d %b %Y, %H:%M:%S")


def _source_has_audio(source_url: str) -> bool:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "csv=p=0",
        source_url,
    ]
    try:
        probe = subprocess.run(command, capture_output=True, check=False, timeout=12)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return probe.returncode == 0 and b"audio" in probe.stdout


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
        if not _source_has_audio(source_url):
            raise RuntimeError("The configured stream has no usable audio track")
        now = datetime.now(UTC)
        RECORDING_ROOT.mkdir(parents=True, exist_ok=True)
        file_name = f"sermon-{now:%Y%m%d-%H%M%S}.webm"
        file_path = RECORDING_ROOT / file_name
        recording = BroadcastRecording(
            plan_id=plan_id,
            plan_item_id=plan_item_id,
            created_by_user_id=created_by_user_id,
            title=_recording_title(now),
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
        threading.Thread(
            target=_watch_recording,
            args=(recording.id, plan_id),
            daemon=True,
            name=f"sermon-recording-{recording.id}",
        ).start()
        return recording


def _watch_recording(recording_id: str, plan_id: str) -> None:
    while True:
        time.sleep(3)
        with _lock:
            if not _active or _active.recording_id != recording_id:
                return
        with SessionLocal() as session:
            presentation_session = session.scalar(
                select(PresentationSession)
                .where(PresentationSession.plan_id == plan_id)
                .order_by(PresentationSession.updated_at.desc())
            )
            position = (
                session.scalar(
                    select(PresentationPosition)
                    .where(PresentationPosition.session_id == presentation_session.id)
                    .order_by(PresentationPosition.updated_at.desc())
                )
                if presentation_session
                else None
            )
            try:
                payload = json.loads(position.payload_json or "{}") if position else {}
            except json.JSONDecodeError:
                payload = {}
            heartbeat = payload.get("output_heartbeat_at")
            item_id = payload.get("plan_item_id")
            item = session.get(PlanItem, item_id) if isinstance(item_id, str) else None
            now_ms = int(datetime.now(UTC).timestamp() * 1000)
            output_live = isinstance(heartbeat, int) and now_ms - heartbeat < 7000
            on_sermon = bool(item and item.item_type == "sermon" and item.deleted_at is None)
            if not output_live or not on_sermon:
                with _lock:
                    if _active and _active.recording_id == recording_id:
                        stop_recording(session, plan_id)
                return


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
        if _active.paused_at is not None:
            resume_recording(session)
        elapsed = max(
            0.0,
            (datetime.now(UTC) - recording.started_at).total_seconds() - _active.paused_seconds,
        )
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
            if active.paused_at is not None:
                active.paused_seconds += (datetime.now(UTC) - active.paused_at).total_seconds()
                active.paused_at = None
                active.process.send_signal(signal.SIGCONT)
            active.process.send_signal(signal.SIGINT)
            try:
                active.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                active.process.terminate()
                active.process.wait(timeout=5)
        if recording:
            recording.ended_at = datetime.now(UTC)
            if recording.started_at:
                recording.duration_seconds = max(
                    0,
                    int(
                        (recording.ended_at - recording.started_at).total_seconds()
                        - active.paused_seconds
                    ),
                )
            path = Path(recording.file_path)
            recording.size_bytes = path.stat().st_size if path.exists() else None
            recording.status = "ready" if recording.size_bytes else "failed"
            session.commit()
            session.refresh(recording)
        return recording


def pause_recording(session: Session) -> BroadcastRecording | None:
    with _lock:
        if not _active or _active.process.poll() is not None:
            return None
        recording = session.get(BroadcastRecording, _active.recording_id)
        if _active.paused_at is None:
            _active.process.send_signal(signal.SIGSTOP)
            _active.paused_at = datetime.now(UTC)
        if recording:
            recording.status = "paused"
            session.commit()
            session.refresh(recording)
        return recording


def resume_recording(session: Session) -> BroadcastRecording | None:
    with _lock:
        if not _active or _active.process.poll() is not None:
            return None
        recording = session.get(BroadcastRecording, _active.recording_id)
        if _active.paused_at is not None:
            _active.paused_seconds += (datetime.now(UTC) - _active.paused_at).total_seconds()
            _active.paused_at = None
            _active.process.send_signal(signal.SIGCONT)
        if recording:
            recording.status = "recording"
            session.commit()
            session.refresh(recording)
        return recording


def sync_sermon_recording(
    session: Session,
    plan_id: str,
    previous_plan_item_id: str | None,
    plan_item_id: str | None,
    slide_offset: int,
    created_by_user_id: str | None,
) -> None:
    item = session.get(PlanItem, plan_item_id) if plan_item_id else None
    previous_item = session.get(PlanItem, previous_plan_item_id) if previous_plan_item_id else None
    came_from_non_sermon = bool(
        previous_item
        and previous_item.plan_id == plan_id
        and previous_item.deleted_at is None
        and previous_item.item_type != "sermon"
    )
    if item and item.plan_id == plan_id and item.item_type == "sermon" and item.deleted_at is None:
        if _active and _active.plan_id == plan_id:
            record_slide_transition(session, plan_id, item.id, slide_offset)
        elif came_from_non_sermon:
            try:
                start_recording(session, plan_id, item.id, created_by_user_id)
                record_slide_transition(session, plan_id, item.id, slide_offset)
            except RuntimeError:
                return
    else:
        stop_recording(session, plan_id)
