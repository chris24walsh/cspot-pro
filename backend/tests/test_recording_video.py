import json
import shutil
import subprocess
from concurrent.futures import Future

import pytest

from app.modules.broadcast import recording_video as video
from app.modules.broadcast.models import BroadcastRecording


def test_slide_timings_include_initial_slide_and_camera_delay():
    events = [
        {"at": 0.5, "slide_offset": 0},
        {"at": 10, "slide_offset": 1},
        {"at": 20, "slide_offset": 2},
    ]
    assert video.timed_events(events, 20, 1.5) == [(events[0], 11.5), (events[1], 8.5)]
    assert video.timed_events(events, 25, 0) == [(events[0], 10), (events[1], 10), (events[2], 5)]
    with pytest.raises(ValueError):
        video.timed_events([], 20, 0)


def test_cached_export_and_duplicate_preparation(tmp_path, monkeypatch):
    recording = BroadcastRecording(id="test", audio_file_path=str(tmp_path / "audio.webm"))
    job = Future()

    class Pool:
        calls = 0

        def submit(self, *args):
            self.calls += 1
            return job

    pool = Pool()
    monkeypatch.setattr(video, "_pool", pool)
    monkeypatch.setattr(video, "_jobs", {})
    assert video.start_video(recording)["status"] == "preparing"
    assert video.start_video(recording)["status"] == "preparing"
    assert pool.calls == 1
    with pytest.raises(ValueError):
        video.delete_video(recording)
    job.set_result(None)
    path = video.video_path(recording)
    path.parent.mkdir()
    path.write_bytes(b"video")
    assert video.video_status(recording)["status"] == "ready"
    assert video.start_video(recording)["status"] == "ready"
    video.delete_video(recording)
    assert not path.exists()


def test_video_contains_audio_and_timed_slides(tmp_path):
    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg is required")
    audio = tmp_path / "audio.m4a"
    video._run(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "aac", str(audio)])
    frames = []
    for color, duration in [("red", 1), ("blue", 2)]:
        image = tmp_path / f"{color}.png"
        video._run(
            [
                "-f",
                "lavfi",
                "-i",
                f"color={color}:s=160x90",
                "-frames:v",
                "1",
                "-threads",
                "1",
                str(image),
            ]
        )
        frames.append((image, duration))
    output = tmp_path / "export.mp4"
    video.encode_video(audio, frames, output, 3)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)],
        capture_output=True,
        check=True,
    )
    data = json.loads(probe.stdout)
    assert {stream["codec_type"] for stream in data["streams"]} == {"audio", "video"}
    assert float(data["format"]["duration"]) == pytest.approx(3, abs=0.15)
    for time, channel in [(0.5, 0), (1.5, 2)]:
        frame = subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-ss",
                str(time),
                "-i",
                str(output),
                "-frames:v",
                "1",
                "-vf",
                "scale=1:1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "pipe:1",
            ],
            capture_output=True,
            check=True,
        )
        assert frame.stdout[channel] > 200
        assert frame.stdout[2 if channel == 0 else 0] < 30
    text_image = tmp_path / "text.png"
    video._text_slide("Sermon\nA plain text slide with 100% literal text", text_image)
    assert text_image.stat().st_size > 0


def test_export_resolves_recorded_decks_and_offsets_without_live_plan(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import MagicMock

    from app.modules.broadcast import routes
    from app.modules.library.models import StoredFile

    recording = BroadcastRecording(
        id="recording",
        status="ready",
        source="trimmed-sermon",
        file_path=str(tmp_path / "audio.m4a"),
        audio_file_path=str(tmp_path / "audio.m4a"),
    )
    (tmp_path / "audio.m4a").write_bytes(b"audio")
    timeline = [
        {
            "at": 0,
            "plan_item_id": "removed",
            "slide_offset": 1,
            "files": [{"file_id": "one"}, {"file_id": "two"}],
        },
        {
            "at": 1,
            "plan_item_id": "removed",
            "slide_offset": 0,
            "files": [{"file_id": "one"}, {"file_id": "two"}],
        },
    ]
    session = MagicMock()
    session.__enter__.return_value = session
    session.get.side_effect = lambda model, key: (
        recording
        if model is BroadcastRecording
        else SimpleNamespace(id=key)
        if model is StoredFile
        else None
    )
    monkeypatch.setattr(video, "SessionLocal", lambda: session)
    monkeypatch.setattr(
        routes, "recording_read", lambda session, row: SimpleNamespace(timeline=timeline)
    )
    monkeypatch.setattr(video, "_media_duration", lambda path: 3)
    monkeypatch.setattr(video, "_render_slides", lambda stored: [tmp_path / f"{stored.id}.png"])
    captured = []

    def encode(audio, frames, output, duration):
        captured.extend(frames)
        output.write_bytes(b"mp4")

    monkeypatch.setattr(video, "encode_video", encode)
    video._export_recording("recording")
    assert captured == [(tmp_path / "two.png", 1), (tmp_path / "one.png", 2)]
    assert video.video_path(recording).read_bytes() == b"mp4"
