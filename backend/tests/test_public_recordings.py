from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

from app.modules.broadcast.models import BroadcastRecording
from app.modules.broadcast.routes import (
    clean_recording_title,
    get_public_recording,
    publish_recording,
    unpublish_recording,
)


def recording() -> BroadcastRecording:
    return BroadcastRecording(
        id="recording",
        title="Sermon Sep 06 2026",
        status="ready",
        source="automatic-sermon",
        media_kind="audio-slides",
        file_path="/tmp/sermon.webm",
        file_name="sermon.webm",
        recorded_at=datetime(2026, 9, 6, 10, tzinfo=UTC),
        timeline_json="[]",
    )


def test_title_comes_from_cleaned_recorded_deck_name():
    row = recording()
    assert (
        clean_recording_title(
            row,
            [{"files": [{"display_name": "  Grace_under-pressure-FINAL.pptx"}]}],
        )
        == "Grace under pressure"
    )
    assert clean_recording_title(row, [{"item_title": "Faith and Hope"}]) == "Faith and Hope"
    assert (
        clean_recording_title(
            row,
            [
                {
                    "files": [
                        {"display_name": "background.jpg"},
                        {"display_name": "The_Good_Shepherd.pptx"},
                    ]
                }
            ],
        )
        == "The Good Shepherd"
    )


def test_publish_is_opt_in_stable_and_revocable():
    row = recording()
    session = Mock()
    session.get.return_value = row
    first = publish_recording(row.id, SimpleNamespace(id="admin"), session)
    token = first.public_token
    assert token and first.published_at
    second = publish_recording(row.id, SimpleNamespace(id="admin"), session)
    assert second.public_token == token
    unpublished = unpublish_recording(row.id, SimpleNamespace(id="admin"), session)
    assert unpublished.public_token is None


def test_public_metadata_contains_only_public_player_assets(monkeypatch):
    row = recording()
    row.public_token = "secret"
    row.duration_seconds = 120
    row.timeline_json = (
        '[{"at":0,"slide_offset":0,"files":'
        '[{"file_id":"deck","display_name":"Hope.pptx"}]},'
        '{"at":30,"slide_offset":1,"files":'
        '[{"file_id":"deck","display_name":"Hope.pptx"}]}]'
    )
    session = Mock()
    session.scalar.return_value = row
    session.get.return_value = None
    result = get_public_recording("secret", session)
    assert result.title == "Hope"
    assert result.audio_url.endswith("/secret/audio")
    assert [slide["at"] for slide in result.slides] == [0, 31.5]
    assert all("secret" in slide["image_url"] for slide in result.slides)
