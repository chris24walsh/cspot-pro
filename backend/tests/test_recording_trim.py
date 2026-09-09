import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from app.modules.broadcast.models import BroadcastRecording
from app.modules.broadcast.recording_trim import create_trimmed_recording, trimmed_timeline
from app.modules.broadcast.schemas import BroadcastRecordingTrim


def test_trim_preserves_active_slide_snapshots_and_display_timing():
    timeline = [
        {"at": 0, "slide_offset": 0, "files": [{"file_id": "deck"}]},
        {"at": 10, "slide_offset": 1},
        {"at": 20, "slide_offset": 2},
        {"at": 30, "slide_offset": 3},
    ]
    result = trimmed_timeline(timeline, 11, 30)
    assert result == [
        {"at": 0, "slide_offset": 0, "files": [{"file_id": "deck"}]},
        {"at": 0.5, "slide_offset": 1},
        {"at": 10.5, "slide_offset": 2},
    ]
    assert timeline[0]["at"] == 0
    assert trimmed_timeline(result, 1, 18, slide_delay=0) == [
        {"at": 0, "slide_offset": 1},
        {"at": 9.5, "slide_offset": 2},
    ]
    assert trimmed_timeline([], 1, 2) == []


@pytest.mark.parametrize("start,end", [(-1, 10), (0, float("inf")), (float("nan"), 10)])
def test_schema_rejects_invalid_times(start, end):
    with pytest.raises(ValidationError):
        BroadcastRecordingTrim(start_seconds=start, end_seconds=end)


@pytest.fixture
def source(tmp_path):
    path = tmp_path / "original.webm"
    path.write_bytes(b"original audio")
    return BroadcastRecording(
        id="source",
        title="Sermon",
        status="ready",
        source="automatic-sermon",
        file_path=str(path),
        audio_file_path=str(path),
        file_name=path.name,
        timeline_json='[{"at": 0, "slide_offset": 0}]',
    )


@pytest.mark.parametrize("start,end", [(10, 5), (0, 200), (10, 10.5)])
def test_invalid_range_does_not_run_encoder(source, monkeypatch, start, end):
    monkeypatch.setattr("app.modules.broadcast.recording_trim._media_duration", lambda path: 100)
    run = Mock()
    monkeypatch.setattr("app.modules.broadcast.recording_trim.subprocess.run", run)
    with pytest.raises(ValueError):
        create_trimmed_recording(Mock(), source, start, end, [], "admin")
    run.assert_not_called()


def test_success_creates_independent_copy(source, monkeypatch):
    monkeypatch.setattr(
        "app.modules.broadcast.recording_trim._media_duration",
        lambda path: 100 if path.name == "original.webm" else 50,
    )

    def encode(command, **kwargs):
        Path(command[-1]).write_bytes(b"trimmed audio")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr("app.modules.broadcast.recording_trim.subprocess.run", encode)
    session = Mock()
    copy = create_trimmed_recording(
        session, source, 10, 60, [{"at": 0, "slide_offset": 0}], "admin"
    )
    assert copy.file_path != source.file_path
    assert copy.duration_seconds == 50
    assert copy.content_type == "audio/webm; codecs=opus"
    assert json.loads(copy.timeline_json) == [{"at": 0, "slide_offset": 0}]
    assert Path(source.file_path).read_bytes() == b"original audio"
    session.commit.assert_called_once()


def test_replace_original_atomically_keeps_identity_and_compact_format(source, monkeypatch):
    monkeypatch.setattr(
        "app.modules.broadcast.recording_trim._media_duration",
        lambda path: 100 if path.read_bytes() == b"original audio" else 50,
    )

    def encode(command, **kwargs):
        assert command[command.index("-c:a") + 1] == "libopus"
        assert command[command.index("-b:a") + 1] == "48k"
        Path(command[-1]).write_bytes(b"smaller trimmed audio")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr("app.modules.broadcast.recording_trim.subprocess.run", encode)
    session = Mock()
    result = create_trimmed_recording(
        session, source, 10, 60, [{"at": 0, "slide_offset": 0}], "admin", True
    )
    assert result is source
    assert source.id == "source"
    assert Path(source.file_path).read_bytes() == b"smaller trimmed audio"
    assert source.duration_seconds == 50
    assert source.content_type is None
    assert not list(Path(source.file_path).parent.glob("*.backup"))


def test_failed_database_replace_restores_original_audio(source, monkeypatch):
    monkeypatch.setattr(
        "app.modules.broadcast.recording_trim._media_duration",
        lambda path: 100 if path.read_bytes() == b"original audio" else 50,
    )

    def encode(command, **kwargs):
        Path(command[-1]).write_bytes(b"trimmed audio")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr("app.modules.broadcast.recording_trim.subprocess.run", encode)
    session = Mock()
    session.commit.side_effect = RuntimeError("Database unavailable")
    with pytest.raises(RuntimeError):
        create_trimmed_recording(session, source, 10, 60, [], "admin", True)
    assert Path(source.file_path).read_bytes() == b"original audio"


@pytest.mark.parametrize("failure", ["encoder", "database"])
def test_failed_trim_cleans_partial_copy_and_preserves_original(source, monkeypatch, failure):
    monkeypatch.setattr("app.modules.broadcast.recording_trim._media_duration", lambda path: 100)

    def encode(command, **kwargs):
        Path(command[-1]).write_bytes(b"partial")
        return SimpleNamespace(returncode=1 if failure == "encoder" else 0)

    monkeypatch.setattr("app.modules.broadcast.recording_trim.subprocess.run", encode)
    session = Mock()
    if failure == "database":
        session.commit.side_effect = RuntimeError("Database unavailable")
    with pytest.raises(RuntimeError):
        create_trimmed_recording(session, source, 10, 60, [], "admin")
    assert list(Path(source.file_path).parent.iterdir()) == [Path(source.file_path)]
    assert Path(source.file_path).read_bytes() == b"original audio"
    session.rollback.assert_called_once()


def test_real_audio_trim_preserves_original_and_selected_duration(tmp_path):
    import shutil
    import subprocess

    from app.modules.broadcast.recording import _media_duration

    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg is required for the media integration test")
    path = tmp_path / "original.webm"
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=6",
            "-c:a",
            "libopus",
            str(path),
        ],
        check=True,
    )
    original = path.read_bytes()
    recording = BroadcastRecording(
        title="Sermon",
        status="ready",
        source="automatic-sermon",
        file_path=str(path),
        audio_file_path=str(path),
        file_name=path.name,
    )
    copy = create_trimmed_recording(Mock(), recording, 1, 4, [], "admin")
    assert _media_duration(Path(copy.file_path)) == pytest.approx(3, abs=0.1)
    assert path.read_bytes() == original
    assert copy.size_bytes > 0
