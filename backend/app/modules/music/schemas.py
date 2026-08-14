from pydantic import BaseModel


class SongBase(BaseModel):
    title: str
    alternate_title: str | None = None
    author: str | None = None
    lyrics: str | None = None
    chords: str | None = None
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
