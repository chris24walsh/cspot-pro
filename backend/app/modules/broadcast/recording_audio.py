"""Compatible MP3 exports for sermon recording downloads."""

import subprocess
import tempfile
from pathlib import Path
from threading import RLock

from app.modules.broadcast.models import BroadcastRecording

_lock = RLock()


def mp3_path(recording: BroadcastRecording) -> Path:
    source = Path(recording.audio_file_path or recording.file_path)
    return source.parent / "exports" / f"{recording.id}.mp3"


def prepare_mp3(recording: BroadcastRecording) -> Path:
    source = Path(recording.audio_file_path or recording.file_path)
    destination = mp3_path(recording)
    with _lock:
        if destination.is_file():
            return destination
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            dir=destination.parent, prefix="building-", suffix=".mp3", delete=False
        ) as temporary:
            output = Path(temporary.name)
        try:
            result = subprocess.run(
                [
                    "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                    "-i", str(source), "-map", "0:a:0", "-vn", "-ac", "1",
                    "-c:a", "libmp3lame", "-b:a", "64k", str(output),
                ],
                capture_output=True,
                check=False,
                timeout=600,
            )
            if result.returncode or not output.is_file() or output.stat().st_size == 0:
                raise RuntimeError("Could not create MP3 download")
            output.replace(destination)
        except Exception:
            output.unlink(missing_ok=True)
            raise
    return destination


def delete_mp3(recording: BroadcastRecording) -> None:
    with _lock:
        mp3_path(recording).unlink(missing_ok=True)
