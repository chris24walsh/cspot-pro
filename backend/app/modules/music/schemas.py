from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class StrumPattern(BaseModel):
    name: str = Field(default="", max_length=80)
    bars: Literal[1, 2] = 1
    section: Literal["Default", "Verse", "Chorus", "Bridge"] = "Default"
    subdivision: Literal[1, 2, 4] = 2
    strokes: list[Literal["D", "U", "S", "s", "-", "X"]] = Field(max_length=96)


class SongBarChart(BaseModel):
    section: str = Field(min_length=1, max_length=80)
    chart: str = Field(max_length=8000)


class RhythmPresetCreate(BaseModel):
    kind: Literal["meter", "strum"]
    name: str = Field(min_length=1, max_length=80)
    numerator: int = Field(ge=1, le=12)
    denominator: Literal[2, 4, 8, 16]
    subdivision: Literal[1, 2, 4] | None = None
    strokes: list[Literal["D", "U", "S", "s", "-", "X"]] | None = Field(default=None, max_length=96)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Give the preset a name")
        return value.strip()

    @model_validator(mode="after")
    def validate_preset(self) -> "RhythmPresetCreate":
        if self.kind == "strum":
            if (
                not self.subdivision
                or not self.strokes
                or len(self.strokes)
                not in (self.numerator * self.subdivision, 2 * self.numerator * self.subdivision)
            ):
                raise ValueError("A strum preset must fill one or two bars")
        elif self.strokes is not None or self.subdivision is not None:
            raise ValueError("Meter presets contain only the time signature")
        return self


class RhythmPresetRead(RhythmPresetCreate):
    id: str


class BarRhythmChange(BaseModel):
    numerator: int = Field(ge=1, le=12)
    denominator: Literal[2, 4, 8, 16]
    scope: Literal["bar", "continue"] = "bar"
    pattern: StrumPattern | None = None

    @model_validator(mode="after")
    def validate_pattern(self) -> "BarRhythmChange":
        if self.pattern and (
            len(self.pattern.strokes)
            != self.numerator * self.pattern.subdivision * self.pattern.bars
        ):
            raise ValueError("Bar pattern must fill its selected meter")
        return self


class BarMarker(BaseModel):
    rhythm: BarRhythmChange | None = None
    id: str = Field(min_length=1, max_length=80)
    section: str | None = Field(default=None, max_length=80)
    lineIndex: int = Field(ge=0)
    anchorIndex: int = Field(ge=0)


class SongRhythm(BaseModel):
    numerator: int = Field(ge=1, le=12)
    denominator: Literal[2, 4, 8, 16]
    patterns: list[StrumPattern] = Field(default_factory=list, max_length=4)
    notes: str = Field(default="", max_length=500)
    bpm: int = Field(default=90, ge=30, le=240)
    visual_beats: int | None = Field(default=None, ge=1, le=12)
    intro_bars: int = Field(default=2, ge=0, le=16, strict=True)
    markers: list[BarMarker] = Field(default_factory=list, max_length=1000)
    arrangements: list[SongBarChart] = Field(default_factory=list, max_length=64)

    @model_validator(mode="after")
    def validate_patterns(self) -> "SongRhythm":
        sections = [pattern.section for pattern in self.patterns]
        if len(sections) != len(set(sections)):
            raise ValueError("Each section may have only one strumming pattern")
        for pattern in self.patterns:
            if len(pattern.strokes) != self.numerator * pattern.subdivision * pattern.bars:
                raise ValueError(
                    "Strumming pattern must fill the selected pattern length and meter"
                )
        chart_sections = [entry.section.strip().casefold() for entry in self.arrangements]
        if len(chart_sections) != len(set(chart_sections)) or any(
            not name for name in chart_sections
        ):
            raise ValueError("Each song part may have only one bar chart")
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
