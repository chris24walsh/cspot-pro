from app.modules.music.text import normalize_song_sequence


def test_normalize_song_sequence_closes_verse_number_gaps() -> None:
    assert normalize_song_sequence("V1 C V3 V4") == "V1 C V2 V3"


def test_normalize_song_sequence_preserves_repeated_verse_references() -> None:
    assert normalize_song_sequence("Verse 1, Chorus, Verse 3, Chorus, Verse 3") == "V1 C V2 C V2"


def test_normalize_song_sequence_handles_pre_chorus() -> None:
    assert normalize_song_sequence("V1 Pre-Chorus 2 V2") == "V1 PC2 V2"
