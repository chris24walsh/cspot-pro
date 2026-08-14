from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.modules.music.models import Song
from app.modules.music.routes import (
    _elapsed_role_can_apply,
    _role_matches,
    _song_matches_categories,
    _suggestion_slots,
    worship_song_usage,
)


def test_suggestion_slots_accept_explicit_replacement_slots() -> None:
    assert _suggestion_slots(5, ["closer"]) == ["closer"]
    assert _suggestion_slots(5, ["middle", "closer"]) == ["middle", "closer"]


def test_suggestion_slots_default_to_full_set_shape() -> None:
    assert _suggestion_slots(5) == ["opener", "middle", "middle", "middle", "closer"]


def test_suggestion_slots_reject_unknown_slots() -> None:
    with pytest.raises(HTTPException):
        _suggestion_slots(5, ["communion"])


def test_role_matching_supports_multiple_song_types() -> None:
    song = Song(title="Multi-role song", worship_role="middle,closer")

    assert _role_matches(song, "middle")
    assert _role_matches(song, "closer")
    assert not _role_matches(song, "opener")


def test_general_suggestions_exclude_seasonal_songs() -> None:
    christmas_song = Song(title="Christmas song", theme_tags="christmas,hymn")
    ordinary_song = Song(title="Ordinary hymn", theme_tags="hymn")

    assert not _song_matches_categories(christmas_song, None)
    assert _song_matches_categories(ordinary_song, None)
    assert _song_matches_categories(christmas_song, ["christmas"])
    assert not _song_matches_categories(ordinary_song, ["christmas"])


def test_removed_role_requires_a_later_elapsed_service_to_return() -> None:
    removed_at = datetime(2026, 8, 14, tzinfo=UTC)

    assert not _elapsed_role_can_apply(removed_at - timedelta(days=7), removed_at)
    assert _elapsed_role_can_apply(removed_at + timedelta(days=7), removed_at)


def test_worship_usage_exposes_last_use_for_inline_rotation_tags(monkeypatch) -> None:
    used_at = datetime(2026, 6, 1, tzinfo=UTC)
    monkeypatch.setattr(
        "app.modules.music.routes._song_usage",
        lambda _session: {"song-1": {"use_count": 3, "last_used": used_at}},
    )

    usage = worship_song_usage(None, object())  # type: ignore[arg-type]

    assert usage[0].song_id == "song-1"
    assert usage[0].use_count == 3
    assert usage[0].last_used == used_at.isoformat()
