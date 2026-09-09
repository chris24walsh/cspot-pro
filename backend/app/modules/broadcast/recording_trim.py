"""Create trimmed audio copies without modifying the source recording."""

import json
import math
import subprocess
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from app.modules.broadcast.models import BroadcastRecording
from app.modules.broadcast.recording import _media_duration


def trimmed_timeline(
    timeline: list[dict],
    start: float,
    end: float,
    slide_delay: float = 1.5,
) -> list[dict]:
    # Trimmed copies store display times with camera latency already applied.
    ordered = sorted(timeline, key=lambda event: event["at"])
    active = next(
        (event for event in reversed(ordered) if event["at"] + slide_delay <= start),
        ordered[0] if ordered else None,
    )
    result = [{**active, "at": 0}] if active else []
    for event in ordered:
        if event is not active and start < event["at"] + slide_delay < end:
            result.append({**event, "at": round(event["at"] + slide_delay - start, 3)})
    return result


def create_trimmed_recording(
    session: Session,
    recording: BroadcastRecording,
    start: float,
    end: float,
    timeline: list[dict],
    user_id: str,
) -> BroadcastRecording:
    if recording.status != "ready":
        raise ValueError("Only finished recordings can be trimmed")
    path = Path(recording.audio_file_path or recording.file_path)
    if not path.is_file():
        raise FileNotFoundError("Recording audio not found")
    duration = _media_duration(path)
    if duration is None:
        raise RuntimeError("Could not read recording duration")
    if not all(math.isfinite(value) for value in (start, end)) or not 0 <= start < end:
        raise ValueError("Choose a start before the end of the recording")
    # The stored duration is rounded to whole seconds; allow that rounding only.
    if end > duration + 0.5 or end - start < 1:
        raise ValueError("Select at least one second within the recording")
    end = min(end, duration)
    if end - start < 1:
        raise ValueError("Select at least one second within the recording")
    output = path.with_name(f"sermon-trimmed-{uuid4().hex}.m4a")
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{start:.3f}",
                "-i",
                str(path),
                "-t",
                f"{end - start:.3f}",
                "-map",
                "0:a:0",
                "-vn",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                "-movflags",
                "+faststart",
                str(output),
            ],
            capture_output=True,
            timeout=300,
            check=False,
        )
        actual_duration = _media_duration(output) if output.is_file() else None
        if result.returncode or actual_duration is None or actual_duration <= 0:
            raise RuntimeError("Could not trim recording audio")
        copy = BroadcastRecording(
            plan_id=recording.plan_id,
            plan_item_id=recording.plan_item_id,
            created_by_user_id=user_id,
            title=f"{recording.title.removesuffix(' (trimmed)')[:210]} (trimmed)",
            source="trimmed-sermon",
            media_kind="audio-slides",
            status="ready",
            file_path=str(output),
            audio_file_path=str(output),
            file_name=output.name,
            content_type="audio/mp4",
            size_bytes=output.stat().st_size,
            duration_seconds=round(actual_duration),
            recorded_at=recording.recorded_at,
            started_at=recording.started_at + timedelta(seconds=start)
            if recording.started_at
            else None,
            ended_at=recording.started_at + timedelta(seconds=end)
            if recording.started_at
            else None,
            end_reason="Trimmed copy",
            timeline_json=json.dumps(
                trimmed_timeline(
                    timeline,
                    start,
                    end,
                    0 if recording.source == "trimmed-sermon" else 1.5,
                )
            ),
        )
        session.add(copy)
        session.commit()
    except Exception:
        session.rollback()
        output.unlink(missing_ok=True)
        raise
    session.refresh(copy)
    return copy
