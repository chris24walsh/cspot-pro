import json
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from app.modules.broadcast.models import BroadcastRecording
from app.modules.broadcast.recording_timeline import effective_timeline
from app.modules.broadcast.recording_trim import create_trimmed_recording
from app.modules.broadcast.recording_visuals import BACKGROUND, render_recording_slide
from app.modules.broadcast.routes import update_recording_visuals
from app.modules.broadcast.schemas import RecordingVisualUpdate


def test_override_restores_latest_captured_slide_without_mutating_capture():
    captured = [
        {"at": 0, "slide_offset": 0},
        {"at": 7, "slide_offset": 1},
        {"at": 12, "slide_offset": 2},
    ]
    original = deepcopy(captured)
    segments = [
        {
            "id": "verse",
            "start_seconds": 4,
            "end_seconds": 10,
            "kind": "bible",
            "title": "John 1",
            "text": "In the beginning",
        }
    ]
    result = effective_timeline(captured, segments)
    assert [(e["at"], e.get("slide_offset"), bool(e.get("visual"))) for e in result] == [
        (0, 0, False),
        (4, 0, True),
        (10, 1, False),
        (12, 2, False),
    ]
    assert captured == original


def test_montage_cycles_images_and_restores_slide_at_end():
    result = effective_timeline(
        [{"at": 0, "slide_offset": 3}],
        [
            {
                "id": "photos",
                "start_seconds": 2,
                "end_seconds": 9,
                "kind": "montage",
                "file_ids": ["a", "b"],
                "dwell_seconds": 2,
            }
        ],
    )
    assert [(e["at"], e.get("files", [])) for e in result] == [
        (0, []),
        (2, [{"file_id": "a"}]),
        (4, [{"file_id": "b"}]),
        (6, [{"file_id": "a"}]),
        (8, [{"file_id": "b"}]),
        (9, []),
    ]
    assert result[-1]["slide_offset"] == 3


def test_montage_decimal_boundaries_advance_without_losing_a_frame():
    result = effective_timeline(
        [],
        [
            {
                "id": "photos",
                "start_seconds": 0.1,
                "end_seconds": 5.1,
                "kind": "montage",
                "file_ids": ["a", "b"],
                "dwell_seconds": 1.3,
            }
        ],
    )
    frames = [
        (event["at"], event["files"][0]["file_id"]) for event in result if event.get("visual")
    ]
    assert frames == [(0.1, "a"), (1.4, "b"), (2.7, "a"), (4.0, "b")]


def test_no_captured_slides_uses_background_before_and_after_segment():
    segment = {
        "id": "verse",
        "start_seconds": 2,
        "end_seconds": 4,
        "kind": "bible",
        "text": "A verse",
    }
    result = effective_timeline([], [segment])
    assert [event["at"] for event in result] == [0, 2, 4]
    assert render_recording_slide(Mock(), result[0], Mock()) == BACKGROUND
    assert render_recording_slide(Mock(), result[-1], Mock()) == BACKGROUND
    assert BACKGROUND.is_file()


def test_bible_render_uses_title_and_text_and_caches_frame(tmp_path, monkeypatch):
    rendered = []

    def render(text, path):
        rendered.append(text)
        path.write_bytes(b"frame")

    monkeypatch.setattr("app.modules.broadcast.recording_video._text_slide", render)
    event = {"visual": {"title": "John 1:1", "text": "In the beginning"}}
    first = render_recording_slide(Mock(), event, tmp_path)
    assert first.is_file()
    assert render_recording_slide(Mock(), event, tmp_path) == first
    assert rendered == ["John 1:1\n\nIn the beginning"]


@pytest.mark.parametrize(
    "segments",
    [
        [{"id": "a", "kind": "background", "start_seconds": 4, "end_seconds": 11}],
        [{"id": "a", "kind": "background", "start_seconds": 4, "end_seconds": 4}],
        [
            {"id": "a", "kind": "background", "start_seconds": 0, "end_seconds": 5},
            {"id": "b", "kind": "background", "start_seconds": 4, "end_seconds": 6},
        ],
        [
            {
                "id": "a",
                "kind": "image",
                "start_seconds": 0,
                "end_seconds": 2,
                "file_ids": ["missing"],
            }
        ],
    ],
)
def test_invalid_visual_segments_are_rejected_without_saving(segments, monkeypatch):
    recording = SimpleNamespace(duration_seconds=10)
    session = Mock()
    session.get.return_value = None
    monkeypatch.setattr("app.modules.broadcast.routes.ready_recording", lambda *_: recording)
    with pytest.raises(HTTPException) as error:
        update_recording_visuals(
            "recording", RecordingVisualUpdate(segments=segments), None, session
        )
    assert error.value.status_code == 422
    session.commit.assert_not_called()


def test_trim_preserves_capture_and_montage_phase(tmp_path, monkeypatch):
    audio = tmp_path / "audio.webm"
    audio.write_bytes(b"audio")
    recording = BroadcastRecording(
        id="original",
        title="Sermon",
        status="ready",
        source="trimmed-sermon",
        file_path=str(audio),
        audio_file_path=str(audio),
        file_name=audio.name,
        visual_segments_json=json.dumps(
            [
                {
                    "id": "montage",
                    "kind": "montage",
                    "start_seconds": 1,
                    "end_seconds": 9,
                    "file_ids": ["a", "b"],
                    "dwell_seconds": 2,
                }
            ]
        ),
    )
    captured = [{"at": 0, "slide_offset": 0}, {"at": 4, "slide_offset": 1}]
    original = deepcopy(captured)
    session = Mock()

    def run(command, **kwargs):
        from pathlib import Path

        Path(command[-1]).write_bytes(b"trimmed audio")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr("app.modules.broadcast.recording_trim.subprocess.run", run)
    monkeypatch.setattr("app.modules.broadcast.recording_trim._media_duration", lambda p: 10)
    copy = create_trimmed_recording(session, recording, 4, 9, captured, "admin", False, True)
    rebased_capture = json.loads(copy.timeline_json)
    segments = json.loads(copy.visual_segments_json)
    assert captured == original
    assert rebased_capture == [{"at": 0, "slide_offset": 1}]
    events = effective_timeline(rebased_capture, segments)
    assert [(e["at"], e.get("files", [])) for e in events] == [
        (0, [{"file_id": "b"}]),
        (1, [{"file_id": "a"}]),
        (3, [{"file_id": "b"}]),
        (5, []),
    ]
    assert json.loads(recording.visual_segments_json)[0]["start_seconds"] == 1


def test_saving_visuals_preserves_captured_timeline_and_invalidates_export(monkeypatch):
    captured = json.dumps(
        [
            {"at": 0, "slide_offset": 0, "files": [{"file_id": "deck"}]},
            {"at": 6, "slide_offset": 1, "files": [{"file_id": "deck"}]},
        ]
    )
    row = BroadcastRecording(
        id="recording",
        title="Sermon",
        status="ready",
        source="trimmed-sermon",
        media_kind="audio-slides",
        file_path="/tmp/recording.webm",
        file_name="recording.webm",
        timeline_json=captured,
        duration_seconds=20,
    )
    session = Mock()
    invalidate = Mock()
    monkeypatch.setattr("app.modules.broadcast.routes.ready_recording", lambda *_: row)
    monkeypatch.setattr("app.modules.broadcast.routes.delete_video", invalidate)
    payload = RecordingVisualUpdate(
        segments=[
            {
                "id": "background",
                "kind": "background",
                "start_seconds": 4,
                "end_seconds": 10,
            }
        ]
    )
    result = update_recording_visuals("recording", payload, None, session)
    assert row.timeline_json == captured
    invalidate.assert_called_once_with(row)
    session.commit.assert_called_once()
    assert result.visual_segments[0].id == "background"
    assert [(event["at"], bool(event.get("visual"))) for event in result.timeline] == [
        (0, False),
        (4, True),
        (10, False),
    ]
    assert result.timeline[-1]["slide_offset"] == 1


def test_editing_during_export_is_rejected_without_changing_visuals(monkeypatch):
    row = SimpleNamespace(duration_seconds=20, visual_segments_json="[]")
    session = Mock()
    monkeypatch.setattr("app.modules.broadcast.routes.ready_recording", lambda *_: row)
    monkeypatch.setattr(
        "app.modules.broadcast.routes.delete_video",
        Mock(side_effect=ValueError("Wait for video preparation to finish")),
    )
    payload = RecordingVisualUpdate(
        segments=[
            {
                "id": "background",
                "kind": "background",
                "start_seconds": 4,
                "end_seconds": 10,
            }
        ]
    )
    with pytest.raises(HTTPException) as error:
        update_recording_visuals("recording", payload, None, session)
    assert error.value.status_code == 409
    assert row.visual_segments_json == "[]"
    session.commit.assert_not_called()


def test_trim_on_decimal_montage_boundary_keeps_full_first_frame(tmp_path, monkeypatch):
    audio = tmp_path / "audio.webm"
    audio.write_bytes(b"original")
    row = BroadcastRecording(
        title="Sermon",
        status="ready",
        source="trimmed-sermon",
        file_path=str(audio),
        file_name=audio.name,
        visual_segments_json=json.dumps(
            [
                {
                    "id": "montage",
                    "kind": "montage",
                    "start_seconds": 1,
                    "end_seconds": 9,
                    "file_ids": ["a", "b"],
                    "dwell_seconds": 1.3,
                }
            ]
        ),
    )

    def encode(command, **kwargs):
        from pathlib import Path

        Path(command[-1]).write_bytes(b"trimmed")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr("app.modules.broadcast.recording_trim.subprocess.run", encode)
    monkeypatch.setattr(
        "app.modules.broadcast.recording_trim._media_duration",
        lambda path: 10 if path == audio else 4.1,
    )
    copy = create_trimmed_recording(Mock(), row, 4.9, 9, [], "admin", False, True)
    segments = json.loads(copy.visual_segments_json)
    assert segments[0]["file_ids"] == ["b"]
    assert segments[0]["end_seconds"] == pytest.approx(1.3)
    assert segments[1]["file_ids"] == ["a", "b"]
    assert segments[-1]["end_seconds"] <= copy.duration_seconds
