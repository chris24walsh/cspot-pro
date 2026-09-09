from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

from app.modules.broadcast.models import BroadcastRecording
from app.modules.broadcast.routes import purge_expired_recordings


def test_recordings_are_purged_after_a_year(tmp_path, monkeypatch):
    now = datetime(2026, 9, 9, tzinfo=UTC)
    expired_path = tmp_path / "expired.webm"
    expired_path.write_bytes(b"audio")
    expired = BroadcastRecording(
        id="expired",
        title="Expired",
        status="ready",
        source="automatic-sermon",
        media_kind="audio-slides",
        file_path=str(expired_path),
        file_name=expired_path.name,
        archived_at=now - timedelta(days=366),
    )
    session = Mock()
    session.scalars.return_value.all.return_value = [expired]
    delete_video = Mock()
    delete_mp3 = Mock()
    monkeypatch.setattr("app.modules.broadcast.routes.delete_video", delete_video)
    monkeypatch.setattr("app.modules.broadcast.routes.delete_mp3", delete_mp3)

    assert purge_expired_recordings(session, now=now) == 1
    session.delete.assert_called_once_with(expired)
    session.commit.assert_called_once()
    delete_video.assert_called_once_with(expired)
    delete_mp3.assert_called_once_with(expired)
    assert not expired_path.exists()
