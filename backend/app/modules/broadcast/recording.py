import json
import logging
import signal
import subprocess
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from queue import Queue
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.broadcast.audio_mix import (
    AudioMixInput,
    audio_mix_inputs,
    audio_mix_signature,
    ffmpeg_recording_mix_command,
)
from app.modules.broadcast.models import BroadcastRecording, BroadcastViewerSettings
from app.modules.planning.models import PlanItem
from app.modules.presentation.models import PresentationPosition, PresentationSession

RECORDING_ROOT = Path("/app/storage/recordings")
logger = logging.getLogger(__name__)


class ActiveRecording:
    def __init__(
        self,
        recording_id: str,
        plan_id: str,
        process: subprocess.Popen[bytes],
        *,
        file_path: Path | None = None,
        inputs: list[AudioMixInput] | None = None,
        segment_paths: list[Path] | None = None,
    ):
        self.recording_id = recording_id
        self.plan_id = plan_id
        self.process = process
        self.file_path = file_path
        self.inputs = inputs or []
        self.segment_paths = segment_paths or []
        self.paused_at: datetime | None = None
        self.paused_seconds = 0.0


_lock = threading.RLock()
_active: ActiveRecording | None = None
START_FAILURE_COOLDOWN_SECONDS = 60
RECORDING_REPAIR_TIMEOUT_SECONDS = 300
AUTOMATIC_RECORDING_MINIMUM_SECONDS = 30


@dataclass(frozen=True)
class RecordingIntent:
    plan_id: str
    previous_plan_item_id: str | None
    plan_item_id: str | None
    slide_offset: int
    created_by_user_id: str | None


_intent_queue: Queue[RecordingIntent] = Queue()
_intent_lock = threading.Lock()
_queued_intents: set[RecordingIntent] = set()
_intent_worker: threading.Thread | None = None
_retry_lock = threading.Lock()
_start_retry_after: dict[tuple[str, str], float] = {}


def _run_recording_intent(intent: RecordingIntent) -> None:
    with SessionLocal() as session:
        sync_sermon_recording(
            session,
            intent.plan_id,
            intent.previous_plan_item_id,
            intent.plan_item_id,
            intent.slide_offset,
            intent.created_by_user_id,
        )


def _recording_intent_worker() -> None:
    while True:
        intent = _intent_queue.get()
        try:
            _run_recording_intent(intent)
        except Exception:
            logger.exception("Could not apply automatic sermon recording state")
        finally:
            with _intent_lock:
                _queued_intents.discard(intent)
            _intent_queue.task_done()


def schedule_sermon_recording(
    plan_id: str,
    previous_plan_item_id: str | None,
    plan_item_id: str | None,
    slide_offset: int,
    created_by_user_id: str | None,
) -> None:
    """Apply a recording transition without retaining the request's DB session."""
    global _intent_worker
    intent = RecordingIntent(
        plan_id=plan_id,
        previous_plan_item_id=previous_plan_item_id,
        plan_item_id=plan_item_id,
        slide_offset=slide_offset,
        created_by_user_id=created_by_user_id,
    )
    with _intent_lock:
        if intent in _queued_intents:
            return
        _queued_intents.add(intent)
        _intent_queue.put(intent)
        if _intent_worker is None or not _intent_worker.is_alive():
            _intent_worker = threading.Thread(
                target=_recording_intent_worker,
                daemon=True,
                name="sermon-recording-intents",
            )
            _intent_worker.start()


def _start_is_in_cooldown(plan_id: str, plan_item_id: str) -> bool:
    retry_key = (plan_id, plan_item_id)
    now = time.monotonic()
    with _retry_lock:
        retry_after = _start_retry_after.get(retry_key)
        if retry_after is None:
            return False
        if now >= retry_after:
            _start_retry_after.pop(retry_key, None)
            return False
        return True


def _record_start_failure(plan_id: str, plan_item_id: str) -> None:
    with _retry_lock:
        _start_retry_after[(plan_id, plan_item_id)] = (
            time.monotonic() + START_FAILURE_COOLDOWN_SECONDS
        )


def _clear_start_failure(plan_id: str, plan_item_id: str) -> None:
    with _retry_lock:
        _start_retry_after.pop((plan_id, plan_item_id), None)


def _source_url(session: Session) -> str | None:
    viewer = session.scalar(select(BroadcastViewerSettings).limit(1))
    inputs = audio_mix_inputs(viewer) if viewer else []
    return inputs[0].url if inputs else None


def _audio_inputs(session: Session) -> list[AudioMixInput]:
    viewer = session.scalar(select(BroadcastViewerSettings).limit(1))
    return audio_mix_inputs(viewer) if viewer else []


def _auto_recording_enabled(session: Session) -> bool:
    enabled = session.scalar(select(BroadcastViewerSettings.auto_record_sermons).limit(1))
    return True if enabled is None else bool(enabled)


def _recording_grace_seconds(session: Session) -> int:
    value = session.scalar(select(BroadcastViewerSettings.recording_grace_seconds).limit(1))
    return 60 if value is None else max(0, min(600, int(value)))


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


def _recording_command(source_url: str, file_path: Path) -> list[str]:
    return ffmpeg_recording_mix_command(
        [AudioMixInput(source_id="recording", url=source_url)], file_path
    )


def _segment_path(file_path: Path, index: int) -> Path:
    return file_path.with_name(f"{file_path.stem}.part-{index:03d}{file_path.suffix}")


def _stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.send_signal(signal.SIGINT)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.terminate()
        process.wait(timeout=5)


def _assemble_recording_segments(active: ActiveRecording) -> bool:
    if active.file_path is None or not active.segment_paths:
        return True
    existing = [path for path in active.segment_paths if path.is_file()]
    if not existing:
        return False
    if len(existing) == 1:
        existing[0].replace(active.file_path)
        return True

    concat_path = active.file_path.with_suffix(f"{active.file_path.suffix}.concat.txt")
    entries: list[str] = []
    for path in existing:
        escaped_path = str(path).replace("'", "'\\''")
        entries.append(f"file '{escaped_path}'\n")
    concat_path.write_text("".join(entries), encoding="utf-8")
    assembled = False
    try:
        combined = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_path),
                "-c",
                "copy",
                str(active.file_path),
            ],
            capture_output=True,
            check=False,
            timeout=RECORDING_REPAIR_TIMEOUT_SECONDS,
        )
        if combined.returncode != 0 or not active.file_path.is_file():
            logger.error("Could not join recording source segments")
            return False
        assembled = True
        return True
    except (OSError, subprocess.TimeoutExpired):
        logger.exception("Could not join recording source segments")
        return False
    finally:
        concat_path.unlink(missing_ok=True)
        if assembled:
            for path in existing:
                path.unlink(missing_ok=True)


def reconfigure_active_recording(session: Session) -> bool:
    """Apply current source, mix, and gain settings to an active recorder."""
    inputs = _audio_inputs(session)
    if not inputs:
        return False
    with _lock:
        active = _active
        if (
            not active
            or active.file_path is None
            or active.paused_at is not None
            or audio_mix_signature(inputs) == audio_mix_signature(active.inputs)
        ):
            return False
    with _lock:
        active = _active
        if not active or active.file_path is None or active.paused_at is not None:
            return False
        if audio_mix_signature(inputs) == audio_mix_signature(active.inputs):
            return False
        next_path = _segment_path(active.file_path, len(active.segment_paths))
        previous_inputs = active.inputs
        _stop_process(active.process)
        try:
            process = subprocess.Popen(
                ffmpeg_recording_mix_command(inputs, next_path),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            logger.exception("Could not reconfigure the active recorder")
            try:
                process = subprocess.Popen(
                    ffmpeg_recording_mix_command(previous_inputs, next_path),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except OSError:
                logger.exception("Could not restore the previous recorder input")
                return False
            active.process = process
            active.segment_paths.append(next_path)
            return False
        active.process = process
        active.inputs = inputs
        active.segment_paths.append(next_path)
        return True


def _media_duration(path: Path) -> float | None:
    try:
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            check=False,
            timeout=20,
        )
        duration = float(probe.stdout.strip())
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None
    return duration if probe.returncode == 0 and duration >= 0 else None


def _repair_discontinuous_timestamps(path: Path) -> bool:
    repaired_path = path.with_name(f".{path.stem}.timestamp-repair.webm")
    repaired_path.unlink(missing_ok=True)
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(path),
        "-vn",
        "-af",
        "asetpts=N/SR/TB",
        "-ac",
        "1",
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        str(repaired_path),
    ]
    try:
        repair = subprocess.run(
            command,
            capture_output=True,
            check=False,
            timeout=RECORDING_REPAIR_TIMEOUT_SECONDS,
        )
        if (
            repair.returncode != 0
            or not repaired_path.is_file()
            or repaired_path.stat().st_size == 0
        ):
            return False
        repaired_path.replace(path)
        return True
    except (OSError, subprocess.TimeoutExpired):
        return False
    finally:
        repaired_path.unlink(missing_ok=True)


def _trim_recording_file(path: Path, duration_seconds: float) -> bool:
    trimmed_path = path.with_name(f".{path.stem}.grace-trim.webm")
    trimmed_path.unlink(missing_ok=True)
    try:
        trim = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(path),
                "-vn",
                "-af",
                f"atrim=end={max(0, duration_seconds):.3f},asetpts=N/SR/TB",
                "-ac",
                "1",
                "-c:a",
                "libopus",
                "-b:a",
                "48k",
                str(trimmed_path),
            ],
            capture_output=True,
            check=False,
            timeout=RECORDING_REPAIR_TIMEOUT_SECONDS,
        )
        if trim.returncode != 0 or not trimmed_path.is_file() or trimmed_path.stat().st_size == 0:
            return False
        trimmed_path.replace(path)
        return True
    except (OSError, subprocess.TimeoutExpired):
        return False
    finally:
        trimmed_path.unlink(missing_ok=True)


def _finalize_recording_file(path: Path, expected_duration: float | None) -> float | None:
    media_duration = _media_duration(path)
    if (
        media_duration is not None
        and expected_duration is not None
        and media_duration > expected_duration + max(5.0, expected_duration * 0.1)
    ):
        logger.warning(
            "Repairing discontinuous recording timestamps for %s (media %.3fs, expected %.3fs)",
            path,
            media_duration,
            expected_duration,
        )
        if _repair_discontinuous_timestamps(path):
            media_duration = _media_duration(path)
        else:
            logger.error("Could not repair discontinuous recording timestamps for %s", path)
    return media_duration


def _should_discard_short_automatic_recording(
    recording: BroadcastRecording,
    duration_seconds: float | None,
    *,
    automatic_departure: bool,
) -> bool:
    return bool(
        recording.source == "automatic-sermon"
        and automatic_departure
        and duration_seconds is not None
        and duration_seconds < AUTOMATIC_RECORDING_MINIMUM_SECONDS
    )


def _delete_recording(session: Session, recording: BroadcastRecording) -> None:
    paths = {recording.file_path, recording.audio_file_path}
    session.delete(recording)
    session.commit()
    for value in paths:
        if not value:
            continue
        try:
            Path(value).unlink(missing_ok=True)
        except OSError:
            logger.exception("Could not delete discarded recording file %s", value)


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

        inputs = _audio_inputs(session)
        if not inputs:
            raise RuntimeError("A recordable camera or audio stream is not configured")
        inputs = [source for source in inputs if _source_has_audio(source.url)]
        if not inputs:
            raise RuntimeError("The configured stream has no usable audio track")
        now = datetime.now(UTC)
        RECORDING_ROOT.mkdir(parents=True, exist_ok=True)
        file_name = f"sermon-{now:%Y%m%d-%H%M%S}.webm"
        file_path = RECORDING_ROOT / file_name
        segment_path = _segment_path(file_path, 0)
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
        command = ffmpeg_recording_mix_command(inputs, segment_path)
        try:
            process = subprocess.Popen(
                command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        except OSError as error:
            recording.status = "failed"
            recording.ended_at = datetime.now(UTC)
            session.commit()
            raise RuntimeError("Could not start the audio recorder") from error
        _active = ActiveRecording(
            recording.id,
            plan_id,
            process,
            file_path=file_path,
            inputs=inputs,
            segment_paths=[segment_path],
        )
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
            owner_id = payload.get("output_owner_id")
            item_id = payload.get("plan_item_id")
            item = session.get(PlanItem, item_id) if isinstance(item_id, str) else None
            now_ms = int(datetime.now(UTC).timestamp() * 1000)
            explicitly_active = payload.get("output_active") is True
            legacy_heartbeat_active = bool(
                "output_active" not in payload
                and isinstance(heartbeat, int)
                and now_ms - heartbeat < 7000
            )
            output_live = isinstance(owner_id, str) and (
                explicitly_active or legacy_heartbeat_active
            )
            on_sermon = bool(item and item.item_type == "sermon" and item.deleted_at is None)
            if output_live and on_sermon:
                cancel_pending_recording_stop(session, plan_id)
            else:
                request_recording_stop(
                    session,
                    plan_id,
                    _recording_departure_reason(item, output_live),
                )
            with _lock:
                if not _active or _active.recording_id != recording_id:
                    return
                recording = session.get(BroadcastRecording, recording_id)
                if recording and recording.pending_stop_at:
                    deadline = recording.pending_stop_at
                    if deadline.tzinfo is None:
                        deadline = deadline.replace(tzinfo=UTC)
                    if deadline <= datetime.now(UTC):
                        stop_recording(
                            session,
                            plan_id,
                            (
                                f"{recording.pending_stop_reason or 'Left sermon'}; "
                                "grace period elapsed"
                            ),
                        )
                        return


def _recording_departure_reason(item: PlanItem | None, output_live: bool) -> str:
    if not output_live:
        return "Slideshow stopped"
    if item is None:
        return "No presentation slide selected"
    if item.item_type == "end":
        return "End slide reached"
    label = (getattr(item, "title", None) or item.item_type or "Non-sermon slide").strip()
    return f"{label} selected"


def request_recording_stop(
    session: Session,
    plan_id: str,
    reason: str,
) -> BroadcastRecording | None:
    with _lock:
        if not _active or _active.plan_id != plan_id:
            return None
        recording = session.get(BroadcastRecording, _active.recording_id)
        if not recording:
            return None
        if recording.pending_stop_at is None:
            now = datetime.now(UTC)
            grace_seconds = _recording_grace_seconds(session)
            if grace_seconds == 0:
                return stop_recording(session, plan_id, reason)
            elapsed = 0.0
            if recording.started_at:
                started_at = recording.started_at
                if started_at.tzinfo is None:
                    started_at = started_at.replace(tzinfo=UTC)
                paused_seconds = _active.paused_seconds
                if _active.paused_at is not None:
                    paused_at = _active.paused_at
                    if paused_at.tzinfo is None:
                        paused_at = paused_at.replace(tzinfo=UTC)
                    paused_seconds += (now - paused_at).total_seconds()
                elapsed = max(0.0, (now - started_at).total_seconds() - paused_seconds)
            recording.pending_stop_at = now + timedelta(seconds=grace_seconds)
            recording.pending_stop_reason = reason
            recording.pending_stop_offset_ms = round(elapsed * 1000)
            session.commit()
            session.refresh(recording)
        return recording


def cancel_pending_recording_stop(
    session: Session,
    plan_id: str,
) -> BroadcastRecording | None:
    with _lock:
        if not _active or _active.plan_id != plan_id:
            return None
        recording = session.get(BroadcastRecording, _active.recording_id)
        if recording and (
            recording.pending_stop_at
            or recording.pending_stop_reason
            or recording.pending_stop_offset_ms is not None
        ):
            recording.pending_stop_at = None
            recording.pending_stop_reason = None
            recording.pending_stop_offset_ms = None
            session.commit()
            session.refresh(recording)
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


def stop_recording(
    session: Session,
    plan_id: str | None = None,
    reason: str = "Stopped manually",
) -> BroadcastRecording | None:
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
            _stop_process(active.process)
        segments_ready = _assemble_recording_segments(active)
        if recording:
            recording.ended_at = datetime.now(UTC)
            pending_stop_reason = recording.pending_stop_reason
            trim_at_seconds = (
                recording.pending_stop_offset_ms / 1000
                if recording.pending_stop_offset_ms is not None
                else None
            )
            recording.pending_stop_at = None
            recording.pending_stop_reason = None
            recording.pending_stop_offset_ms = None
            recording.end_reason = (
                f"{pending_stop_reason}; ended during grace period"
                if pending_stop_reason and reason == "Stopped manually"
                else reason
            )
            expected_duration: float | None = None
            if recording.started_at:
                expected_duration = max(
                    0.0,
                    (recording.ended_at - recording.started_at).total_seconds()
                    - active.paused_seconds,
                )
            path = Path(recording.audio_file_path or recording.file_path)
            retained_duration = (
                trim_at_seconds if trim_at_seconds is not None else expected_duration
            )
            if _should_discard_short_automatic_recording(
                recording,
                retained_duration,
                automatic_departure=trim_at_seconds is not None or reason != "Stopped manually",
            ):
                logger.info(
                    "Discarding short automatic sermon recording %s (%.3fs)",
                    recording.id,
                    retained_duration,
                )
                _delete_recording(session, recording)
                return None
            if trim_at_seconds is not None and path.exists():
                if _trim_recording_file(path, trim_at_seconds):
                    expected_duration = trim_at_seconds
                else:
                    logger.error("Could not trim recording grace audio from %s", path)
            media_duration = (
                _finalize_recording_file(path, expected_duration) if path.exists() else None
            )
            duration = media_duration if media_duration is not None else expected_duration
            recording.duration_seconds = (
                max(0, int(round(duration))) if duration is not None else None
            )
            recording.size_bytes = path.stat().st_size if path.exists() else None
            recording.status = "ready" if segments_ready and recording.size_bytes else "failed"
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
            recording.pending_stop_at = None
            recording.pending_stop_reason = None
            recording.pending_stop_offset_ms = None
            session.commit()
            session.refresh(recording)
        reconfigure_active_recording(session)
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
    if item and item.plan_id == plan_id and item.item_type == "sermon" and item.deleted_at is None:
        if _active and _active.plan_id == plan_id:
            cancel_pending_recording_stop(session, plan_id)
            record_slide_transition(session, plan_id, item.id, slide_offset)
        elif previous_plan_item_id != item.id and not _start_is_in_cooldown(plan_id, item.id):
            if not _auto_recording_enabled(session):
                return
            try:
                start_recording(session, plan_id, item.id, created_by_user_id)
                record_slide_transition(session, plan_id, item.id, slide_offset)
            except RuntimeError as error:
                _record_start_failure(plan_id, item.id)
                logger.warning("Could not start automatic sermon recording: %s", error)
                return
            _clear_start_failure(plan_id, item.id)
    elif _active and _active.plan_id == plan_id:
        if item and item.plan_id == plan_id and item.deleted_at is None:
            record_slide_transition(session, plan_id, item.id, slide_offset)
        request_recording_stop(
            session,
            plan_id,
            _recording_departure_reason(item, output_live=plan_item_id is not None),
        )
