from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

from app.modules.broadcast.models import BroadcastRecording
from app.modules.broadcast.routes import (
    _apply_legacy_deck_candidates,
    archive_recording,
    clean_recording_title,
    get_public_recording,
    publish_recording,
    rename_recording,
    restore_recording,
    unpublish_recording,
)
from app.modules.broadcast.schemas import BroadcastRecordingRename


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


def test_custom_title_overrides_deck_name_and_can_be_cleared():
    row = recording()
    session = Mock()
    session.get.return_value = row
    renamed = rename_recording(
        row.id,
        BroadcastRecordingRename(title="  A Better Name  "),
        SimpleNamespace(id="admin"),
        session,
    )
    assert renamed.title == "A Better Name"
    assert renamed.custom_title == "A Better Name"
    assert (
        clean_recording_title(row, [{"files": [{"display_name": "Deck.pptx"}]}]) == "A Better Name"
    )
    restored = rename_recording(
        row.id, BroadcastRecordingRename(title=" "), SimpleNamespace(id="admin"), session
    )
    assert restored.custom_title is None
    assert session.commit.call_count == 2


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


def test_archiving_revokes_public_access_and_can_be_restored():
    row = recording()
    row.public_token = "public-token"
    session = Mock()
    session.get.return_value = row
    archived = archive_recording(row.id, SimpleNamespace(id="admin"), session)
    assert archived.archived_at is not None
    assert archived.public_token is None
    restored = restore_recording(row.id, SimpleNamespace(id="admin"), session)
    assert restored.archived_at is None


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


def test_legacy_timeline_uses_matching_readded_deck():
    timeline = [
        {"at": 85, "plan_item_id": "orphan", "slide_offset": 12},
        {"at": 130, "plan_item_id": "orphan", "slide_offset": 13},
    ]
    candidate = {
        "plan_item_id": "readded",
        "item_title": "Rev 1 August 9",
        "files": [
            {
                "file_id": "deck",
                "content_type": "application/presentation",
            }
        ],
    }

    _apply_legacy_deck_candidates(timeline, [candidate])

    assert {event["plan_item_id"] for event in timeline} == {"readded"}
    assert all(event["files"][0]["file_id"] == "deck" for event in timeline)


def test_legacy_timeline_switches_deck_when_second_speaker_restarts_at_zero():
    timeline = [
        {"at": 0, "plan_item_id": "orphan", "slide_offset": 0},
        {"at": 144, "plan_item_id": "orphan", "slide_offset": 2},
        {"at": 849, "plan_item_id": "orphan", "slide_offset": 3},
        {"at": 1312, "plan_item_id": "orphan", "slide_offset": 0},
        {"at": 1318, "plan_item_id": "orphan", "slide_offset": 2},
    ]
    candidates = [
        {
            "plan_item_id": "speaker-one",
            "files": [{"file_id": "deck-one", "content_type": "application/vnd.ms-powerpoint"}],
        },
        {
            "plan_item_id": "speaker-two",
            "files": [
                {
                    "file_id": "deck-two",
                    "content_type": "application/presentation",
                }
            ],
        },
    ]

    _apply_legacy_deck_candidates(timeline, candidates)

    assert [event["plan_item_id"] for event in timeline] == [
        "speaker-one",
        "speaker-one",
        "speaker-one",
        "speaker-two",
        "speaker-two",
    ]


def test_embedded_deck_snapshot_is_not_replaced():
    timeline = [
        {
            "at": 0,
            "plan_item_id": "original",
            "slide_offset": 0,
            "files": [{"file_id": "snapshot", "display_name": "Original.pptx"}],
        }
    ]
    _apply_legacy_deck_candidates(timeline, [{"plan_item_id": "replacement", "files": []}])
    assert timeline[0]["plan_item_id"] == "original"
