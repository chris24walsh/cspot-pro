"""Background MP4 exports of sermon audio and synchronized slide images."""

import logging
import subprocess
import tempfile
import textwrap
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from threading import RLock

from app.core.database import SessionLocal
from app.modules.broadcast.models import BroadcastRecording
from app.modules.broadcast.recording import _media_duration
from app.modules.library.models import StoredFile
from app.modules.library.routes import _render_slides
from app.modules.planning.models import PlanItem

logger = logging.getLogger(__name__)
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="recording-video")
_jobs: dict[str, Future] = {}
_lock = RLock()


def video_path(recording: BroadcastRecording) -> Path:
    return (
        Path(recording.audio_file_path or recording.file_path).parent
        / "exports"
        / f"{recording.id}.mp4"
    )


def video_status(recording: BroadcastRecording) -> dict[str, str]:
    with _lock:
        if video_path(recording).is_file():
            return {"status": "ready"}
        job = _jobs.get(recording.id)
        if job is None:
            return {"status": "idle"}
        if not job.done():
            return {"status": "preparing"}
        return {
            "status": "failed",
            "message": (
                "Could not prepare the video. Check that the recorded slides "
                "are available, then try again."
            ),
        }


def start_video(recording: BroadcastRecording) -> dict[str, str]:
    with _lock:
        state = video_status(recording)
        if state["status"] in {"ready", "preparing"}:
            return state
        if sum(not job.done() for job in _jobs.values()) >= 3:
            return {
                "status": "busy",
                "message": "Other recordings are being prepared. Please try again shortly.",
            }
        # Completed jobs need no memory entry once the output is on disk.
        for key, job in list(_jobs.items()):
            if job.done():
                del _jobs[key]
        _jobs[recording.id] = _pool.submit(_export_recording, recording.id)
        return {"status": "preparing"}


def delete_video(recording: BroadcastRecording) -> None:
    with _lock:
        job = _jobs.get(recording.id)
        if job and not job.done():
            raise ValueError("Wait for video preparation to finish before deleting this recording")
        video_path(recording).unlink(missing_ok=True)
        _jobs.pop(recording.id, None)


def timed_events(timeline: list[dict], duration: float, delay: float) -> list[tuple[dict, float]]:
    ordered = sorted(timeline, key=lambda event: event["at"])
    if not ordered:
        raise ValueError("This recording has no slideshow timings")
    starts = [(ordered[0], 0.0)]
    for event in ordered[1:]:
        at = max(0.0, float(event["at"]) + delay)
        if at >= duration:
            break
        if at == starts[-1][1]:
            starts[-1] = (event, at)
        else:
            starts.append((event, at))
    return [
        (event, (starts[index + 1][1] if index + 1 < len(starts) else duration) - at)
        for index, (event, at) in enumerate(starts)
    ]


def _run(arguments: list[str], timeout: int = 120) -> None:
    result = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", *arguments],
        capture_output=True,
        check=False,
        timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError("Could not render recording video")


def encode_video(
    audio: Path, frames: list[tuple[Path, float]], output: Path, duration: float
) -> None:
    with tempfile.TemporaryDirectory(prefix="recording-video-") as folder:
        work = Path(folder)
        normalized: dict[Path, Path] = {}
        manifest = []
        for image, seconds in frames:
            if image not in normalized:
                target = work / f"slide-{len(normalized)}.png"
                _run(
                    [
                        "-i",
                        str(image),
                        "-vf",
                        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:white,setsar=1",
                        "-frames:v",
                        "1",
                        "-threads",
                        "1",
                        str(target),
                    ]
                )
                normalized[image] = target
            manifest.extend([f"file '{normalized[image].name}'", f"duration {seconds:.6f}"])
        manifest.append(f"file '{normalized[frames[-1][0]].name}'")
        listing = work / "slides.txt"
        listing.write_text("\n".join(manifest) + "\n")
        _run(
            [
                "-f",
                "concat",
                "-safe",
                "1",
                "-i",
                str(listing),
                "-i",
                str(audio),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-t",
                f"{duration:.6f}",
                "-vf",
                "fps=10,format=yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-tune",
                "stillimage",
                "-crf",
                "24",
                "-threads",
                "2",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                "-movflags",
                "+faststart",
                str(output),
            ],
            timeout=3600,
        )


def _text_slide(text: str, path: Path) -> None:
    lines = [
        line for paragraph in text.splitlines() for line in (textwrap.wrap(paragraph, 55) or [""])
    ]
    font_size = min(38, max(12, int(580 / max(1, len(lines)))))
    text_path = path.with_suffix(".txt")
    text_path.write_text("\n".join(lines))
    _run(
        [
            "-f",
            "lavfi",
            "-i",
            "color=c=white:s=1280x720",
            "-vf",
            f"drawtext=textfile={text_path}:expansion=none:fontcolor=black:fontsize={font_size}:x=(w-tw)/2:y=(h-th)/2",
            "-frames:v",
            "1",
            "-threads",
            "1",
            str(path),
        ]
    )


def _export_recording(recording_id: str) -> None:
    # Local import avoids a route/service import cycle.
    from app.modules.broadcast.routes import recording_read

    try:
        with SessionLocal() as session:
            recording = session.get(BroadcastRecording, recording_id)
            if recording is None or recording.status != "ready":
                raise ValueError("Recording is unavailable")
            timeline = recording_read(session, recording).timeline
            files = {
                file["file_id"]: session.get(StoredFile, file["file_id"])
                for event in timeline
                for file in event.get("files", [])
            }
            text_by_item = {}
            for event in timeline:
                item = session.get(PlanItem, event.get("plan_item_id"))
                text_by_item[event.get("plan_item_id")] = (
                    event.get("item_comment")
                    or (item.comment if item else None)
                    or event.get("item_title")
                    or (item.title if item else None)
                )
            audio = Path(recording.audio_file_path or recording.file_path)
            destination = video_path(recording)
            delay = 0 if recording.source == "trimmed-sermon" else 1.5
        duration = _media_duration(audio)
        if not duration or not audio.is_file():
            raise ValueError("Recording audio is unavailable")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=destination.parent, prefix="building-") as folder:
            work = Path(folder)
            rendered = {}
            text_images = {}
            frames = []
            for event, seconds in timed_events(timeline, duration, delay):
                images = []
                for file in event.get("files", []):
                    key = file["file_id"]
                    if key not in rendered:
                        stored = files[key]
                        if stored is None:
                            raise ValueError("A recorded slide deck is missing")
                        rendered[key] = _render_slides(stored)
                    images.extend(rendered[key])
                if images:
                    image = images[min(max(int(event.get("slide_offset", 0)), 0), len(images) - 1)]
                else:
                    if int(event.get("slide_offset", 0)) > 0:
                        raise ValueError("Recorded slide images are unavailable")
                    if event.get("item_type") not in {
                        None,
                        "sermon",
                        "custom",
                        "prayer",
                        "reading",
                    }:
                        raise ValueError("This section cannot be exported without slide images")
                    text = text_by_item.get(event.get("plan_item_id"))
                    if not text:
                        raise ValueError("Recorded slide content is unavailable")
                    if text not in text_images:
                        text_images[text] = work / f"text-{len(text_images)}.png"
                        _text_slide(text, text_images[text])
                    image = text_images[text]
                frames.append((image, seconds))
            output = work / "video.mp4"
            encode_video(audio, frames, output, duration)
            exported_duration = _media_duration(output)
            if exported_duration is None or abs(exported_duration - duration) > 1:
                raise RuntimeError("Exported video duration does not match recording")
            output.replace(destination)
    except Exception:
        logger.exception("Could not export recording video %s", recording_id)
        raise
