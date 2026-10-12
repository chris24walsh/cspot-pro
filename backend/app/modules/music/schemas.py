from typing import Literal

from pydantic import BaseModel, Field, model_validator


class StrumPattern(BaseModel):
    section: Literal["Default", "Verse", "Chorus", "Bridge"] = "Default"
    subdivision: Literal[1, 2] = 2
    strokes: list[Literal["D", "U", "-", "X"]] = Field(max_length=24)


class SongRhythm(BaseModel):
    numerator: int = Field(ge=1, le=12)
    denominator: Literal[2, 4, 8, 16]
    patterns: list[StrumPattern] = Field(default_factory=list, max_length=4)
    notes: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_patterns(self) -> "SongRhythm":
        sections = [pattern.section for pattern in self.patterns]
        if len(sections) != len(set(sections)):
            raise ValueError("Each section may have only one strumming pattern")
        for pattern in self.patterns:
            if len(pattern.strokes) != self.numerator * pattern.subdivision:
                raise ValueError(
                    "Strumming pattern must fill exactly one bar of the selected meter"
                )
        return self


class SongBase(BaseModel):
    title: str
    alternate_title: str | None = None
    author: str | None = None
    lyrics: str | None = None
    chords: str | None = None
    rhythm: SongRhythm | None = None
    ccli_number: str | None = None
    book_reference: str | None = None
    license: str | None = None
    sequence: str | None = None
    youtube_id: str | None = None
    external_link: str | None = None
    worship_role: str | None = None
    energy: int | None = None
    tempo: str | None = None
    theme_tags: str | None = None


class SongCreate(SongBase):
    pass


class SongUpdate(BaseModel):
    title: str | None = None
    alternate_title: str | None = None
    author: str | None = None
    lyrics: str | None = None
    chords: str | None = None
    rhythm: SongRhythm | None = None
    ccli_number: str | None = None
    book_reference: str | None = None
    license: str | None = None
    sequence: str | None = None
    youtube_id: str | None = None
    external_link: str | None = None
    worship_role: str | None = None
    energy: int | None = None
    tempo: str | None = None
    theme_tags: str | None = None


class SongRead(SongBase):
    id: str
    lyrics_status: str


class SongPartRead(BaseModel):
    id: str
    name: str
    abbreviation: str
    sort_order: int


class WorshipSongUsageRead(BaseModel):
    use_count: int
    last_used: str | None = None


class WorshipSongUsageEntryRead(WorshipSongUsageRead):
    song_id: str


class WorshipSuggestedSongRead(BaseModel):
    song: SongRead
    slot: str
    score: float
    reason: str
    usage: WorshipSongUsageRead


class WorshipSetSuggestionRead(BaseModel):
    songs: list[WorshipSuggestedSongRead]


class WorshipSuggestionFeedbackCreate(BaseModel):
    song_id: str
    slot: str
    action: str = "rejected"
