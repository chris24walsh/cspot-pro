from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from app.modules.broadcast import routes
from app.modules.broadcast.schemas import RecordingVisualPreview


def test_preview_caches_successful_layout_by_text(monkeypatch):
    routes.validate_text_slide_fit.cache_clear()
    layout = Mock()
    monkeypatch.setattr(routes, "text_slide_layout", layout)
    monkeypatch.setattr(routes, "ready_recording", lambda *_: SimpleNamespace(duration_seconds=20))
    monkeypatch.setattr(
        routes,
        "recording_read",
        lambda *_args, **_kwargs: SimpleNamespace(timeline=[{"at": 0, "files": []}]),
    )
    monkeypatch.setattr(routes, "recording_slide_response", lambda *_: SimpleNamespace(headers={}))
    session = Mock()
    segments = [
        {"id": "a", "start_seconds": 0, "end_seconds": 4, "kind": "bible", "text": "Verse"},
        {"id": "b", "start_seconds": 4, "end_seconds": 8, "kind": "bible", "text": "Verse"},
    ]
    payload = RecordingVisualPreview(at_seconds=2, segments=segments)
    try:
        routes.preview_recording_visuals("id", payload, None, session)
        routes.preview_recording_visuals("id", payload, None, session)
        layout.assert_called_once_with("Verse")
        payload.segments[1].text = "A changed verse"
        routes.preview_recording_visuals("id", payload, None, session)
        assert layout.call_count == 2
        layout.assert_called_with("A changed verse")
        session.commit.assert_not_called()
    finally:
        routes.validate_text_slide_fit.cache_clear()


def test_failed_layout_is_not_cached(monkeypatch):
    routes.validate_text_slide_fit.cache_clear()
    layout = Mock(side_effect=ValueError("Does not fit"))
    monkeypatch.setattr(routes, "text_slide_layout", layout)
    payload = RecordingVisualPreview(
        at_seconds=0,
        segments=[
            {"id": "a", "start_seconds": 0, "end_seconds": 4, "kind": "bible", "text": "Too long"}
        ],
    )
    try:
        for _ in range(2):
            with pytest.raises(HTTPException) as exc:
                routes.validate_recording_visuals(
                    Mock(), SimpleNamespace(duration_seconds=10), payload.segments
                )
            assert exc.value.status_code == 422
            assert exc.value.detail == "Does not fit"
        assert layout.call_count == 2
    finally:
        routes.validate_text_slide_fit.cache_clear()


def test_invalid_structure_does_not_populate_layout_cache(monkeypatch):
    routes.validate_text_slide_fit.cache_clear()
    layout = Mock()
    monkeypatch.setattr(routes, "text_slide_layout", layout)
    payload = RecordingVisualPreview(
        at_seconds=0,
        segments=[
            {"id": "a", "start_seconds": 0, "end_seconds": 5, "kind": "bible", "text": "Verse"},
            {"id": "b", "start_seconds": 4, "end_seconds": 6, "kind": "background"},
        ],
    )
    with pytest.raises(HTTPException):
        routes.validate_recording_visuals(
            Mock(), SimpleNamespace(duration_seconds=10), payload.segments
        )
    layout.assert_not_called()
    assert routes.validate_text_slide_fit.cache_info().currsize == 0
