from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import app.models  # noqa: F401 -- register the model graph for SQLite
from app.core.database import Base
from app.modules.broadcast import recording as recorder
from app.modules.broadcast.models import BroadcastRecording


def test_restart_recovery_clears_expired_countdown_and_preserves_source(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    target = tmp_path / "sermon.webm"
    part = tmp_path / "sermon.part-000.webm"
    part.write_bytes(b"interrupted capture")
    monkeypatch.setattr(recorder, "_active", None)

    def remux(command, **_kwargs):
        assert str(part) in command
        assert str(target.with_name("sermon.recovered.webm")) == command[-1]
        target.with_name("sermon.recovered.webm").write_bytes(b"playable capture")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(recorder.subprocess, "run", remux)
    monkeypatch.setattr(recorder, "_media_duration", lambda _path: 42.0)
    with Session(engine) as session:
        deadline = datetime.now(UTC) - timedelta(minutes=2)
        row = BroadcastRecording(
            id="interrupted", title="Sermon", status="recording", source="automatic-sermon",
            media_kind="audio-slides", file_path=str(target), file_name=target.name,
            audio_file_path=str(target), started_at=deadline - timedelta(minutes=5),
            pending_stop_at=deadline, pending_stop_reason="Post-service montage selected",
        )
        session.add(row)
        session.commit()

        result = recorder.stop_recording(session, plan_id=None)

        assert result is not None
        assert result.status == "ready"
        assert result.pending_stop_at is None
        assert result.duration_seconds == 42
        assert part.read_bytes() == b"interrupted capture"
        assert target.with_name("sermon.recovered.webm").read_bytes() == b"playable capture"


def test_restart_recovery_clears_countdown_when_audio_cannot_be_found(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(recorder, "_active", None)
    with Session(engine) as session:
        row = BroadcastRecording(
            id="missing", title="Sermon", status="recording", source="automatic-sermon",
            media_kind="audio-slides", file_path=str(tmp_path / "missing.webm"),
            file_name="missing.webm", pending_stop_at=datetime.now(UTC) - timedelta(minutes=1),
        )
        session.add(row)
        session.commit()

        result = recorder.recover_orphaned_recordings(session)

        assert len(result) == 1
        assert result[0].status == "failed"
        assert result[0].pending_stop_at is None


def test_expired_countdown_is_finished_when_recordings_are_polled(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    monkeypatch.setattr(recorder, "_active", None)
    with Session(engine) as session:
        session.add(BroadcastRecording(
            id="expired", title="Sermon", status="recording", source="automatic-sermon",
            media_kind="audio-slides", file_path=str(tmp_path / "missing.webm"),
            file_name="missing.webm", pending_stop_at=datetime.now(UTC) - timedelta(minutes=1),
        ))
        session.commit()

        recorder.finish_expired_recordings(session)

        row = session.scalar(select(BroadcastRecording))
        assert row.status == "failed"
        assert row.pending_stop_at is None
