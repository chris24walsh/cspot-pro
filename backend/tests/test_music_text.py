from app.modules.music.text import (
    normalize_song_lyrics,
    normalize_song_sequence,
    normalize_song_text,
)


def test_normalize_song_sequence_closes_verse_number_gaps() -> None:
    assert normalize_song_sequence("V1 C V3 V4") == "V1 C V2 V3"


def test_normalize_song_sequence_preserves_repeated_verse_references() -> None:
    assert normalize_song_sequence("Verse 1, Chorus, Verse 3, Chorus, Verse 3") == "V1 C V2 C V2"


def test_normalize_song_sequence_handles_pre_chorus() -> None:
    assert normalize_song_sequence("V1 Pre-Chorus 2 V2") == "V1 P2 V2"


def test_normalize_song_sequence_accepts_pre_chorus_and_tag_shorthands() -> None:
    assert normalize_song_sequence("PreChorus PC P Tag T") == "P P P T T"


def test_normalize_song_sequence_accepts_outro_and_o() -> None:
    assert normalize_song_sequence("Outro O") == "O O"


def test_normalize_song_text_prunes_deprecated_labels_and_aligns_verses() -> None:
    lyrics = (
        "[Verse 1]\nFirst\n\n[Section2]\n\n[Verse 3]\nThird\n\n"
        "[Verse 4]\nFourth\n\n[Broken]\nIgnore the label"
    )

    assert normalize_song_text(lyrics, "V1 S2 V3 Broken V4") == (
        "[V1]\nFirst\n\n[V2]\nThird\n\n[V3]\nFourth\n\nIgnore the label",
        "V1 V2 V3",
    )


def test_normalize_song_lyrics_preserves_repeated_verse_references() -> None:
    assert normalize_song_lyrics("[V3]\nWords\n\n[V3]")[0] == "[V1]\nWords\n\n[V1]"


def test_normalize_song_text_replaces_a_stale_like_for_like_sequence() -> None:
    lyrics = "[V1]\nFirst\n\n[C]\nSing together\n\n[V2]\nSecond"

    assert normalize_song_text(lyrics, "V1 V2 V3")[1] == "V1 C V2"


def test_normalize_song_text_preserves_a_longer_arranged_sequence() -> None:
    lyrics = "[V1]\nFirst\n\n[C]\nSing together\n\n[V2]\nSecond"

    assert normalize_song_text(lyrics, "V1 C V2 C V1 C")[1] == "V1 C V2 C V1 C"


def test_normalize_song_text_adds_missing_lyrics_to_a_longer_sequence() -> None:
    lyrics = "[V1]\nFirst\n\n[C]\nSing together\n\n[V2]\nSecond\n\n[B]\nBuild again"

    assert normalize_song_text(lyrics, "V1 C V2 C V1 C")[1] == "V1 C V2 B C V1 C"


def test_section_multipliers_survive_normalization_and_reconciliation():
    lyrics = "[V1]\nFirst\n[C]\nSing chorus\n[V2]\nSecond\n[C2]\nOther chorus"
    expected = "V1 Cx2 V2 C2x3"
    assert normalize_song_sequence("V1 C x2 V2 C2X3") == expected
    assert normalize_song_text(lyrics, expected) == (lyrics, expected)
    assert normalize_song_text(lyrics, "Verse 1 x2 Chorus ×3 Verse 2 C2")[1] == "V1x2 Cx3 V2 C2"
    assert (
        normalize_song_text("[V1]\nFirst\n[C]\nSing chorus\n[V2]\nSecond", "Cx2")[1] == "V1 Cx2 V2"
    )


def test_numbered_verses_keep_repeat_counts_when_renumbered():
    assert (
        normalize_song_text("[V3]\nFirst\n[C]\nSing chorus\n[V4]\nSecond", "V3x2 Cx3 V4")[1]
        == "V1x2 Cx3 V2"
    )


def test_repeat_limits_are_validated_by_song_payloads():
    import pytest
    from pydantic import ValidationError

    from app.modules.music.schemas import SongCreate, SongUpdate

    for sequence in ["Cx0", "Cx100", "Cx2.5", "Cx-2", "Cx", "Cxword", "C x999999999999999999999"]:
        for payload in [SongCreate, SongUpdate]:
            with pytest.raises(ValidationError, match="whole numbers from 1 to 99"):
                payload(title="Test", sequence=sequence)
    assert SongCreate(title="Test", sequence="Cx99").sequence == "Cx99"
