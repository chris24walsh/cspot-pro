from pathlib import Path
from types import SimpleNamespace

from app.modules.broadcast.models import BroadcastRecording
from app.modules.broadcast.recording_audio import delete_mp3, mp3_path, prepare_mp3


def recording(source: Path) -> BroadcastRecording:
    return BroadcastRecording(
        id="recording-1",
        title="Sermon",
        status="ready",
        source="automatic-sermon",
        media_kind="audio-slides",
        file_path=str(source),
        audio_file_path=str(source),
        file_name=source.name,
    )


def test_mp3_export_is_mono_compact_and_cached(tmp_path, monkeypatch):
    source = tmp_path / "sermon.webm"
    source.write_bytes(b"opus")
    row = recording(source)
    calls = []

    def run(arguments, **kwargs):
        calls.append(arguments)
        Path(arguments[-1]).write_bytes(b"mp3")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr("app.modules.broadcast.recording_audio.subprocess.run", run)
    assert prepare_mp3(row).read_bytes() == b"mp3"
    assert prepare_mp3(row).read_bytes() == b"mp3"
    assert len(calls) == 1
    assert "-y" in calls[0]
    assert [calls[0][calls[0].index("-ac") + 1], calls[0][calls[0].index("-b:a") + 1]] == ["1", "64k"]

    delete_mp3(row)
    assert not mp3_path(row).exists()
