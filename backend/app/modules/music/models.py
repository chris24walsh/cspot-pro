from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class Song(IdMixin, TimestampMixin, Base):
    __tablename__ = "songs"

    title: Mapped[str] = mapped_column(String(220), index=True)
    alternate_title: Mapped[str | None] = mapped_column(String(220), index=True)
    author: Mapped[str | None] = mapped_column(String(220))
    lyrics: Mapped[str | None] = mapped_column(Text)
    chords: Mapped[str | None] = mapped_column(Text)
    ccli_number: Mapped[str | None] = mapped_column(String(80), index=True)
    book_reference: Mapped[str | None] = mapped_column(String(220))
    license: Mapped[str | None] = mapped_column(String(80))
    sequence: Mapped[str | None] = mapped_column(String(120))
    youtube_id: Mapped[str | None] = mapped_column(String(80))
    external_link: Mapped[str | None] = mapped_column(String(500))
    worship_role: Mapped[str | None] = mapped_column(String(40), index=True)
    energy: Mapped[int | None] = mapped_column(Integer)
    tempo: Mapped[str | None] = mapped_column(String(40))
    theme_tags: Mapped[str | None] = mapped_column(String(500))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SongWorshipRoleRemoval(IdMixin, TimestampMixin, Base):
    __tablename__ = "song_worship_role_removals"
    __table_args__ = (UniqueConstraint("song_id", "role", name="uq_song_worship_role_removal"),)

    song_id: Mapped[str] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(40), index=True)
    removed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class WorshipSuggestionFeedback(IdMixin, TimestampMixin, Base):
    __tablename__ = "worship_suggestion_feedback"

    song_id: Mapped[str] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"), index=True)
    slot: Mapped[str] = mapped_column(String(40), index=True)
    action: Mapped[str] = mapped_column(String(40), index=True)


class SongPart(IdMixin, TimestampMixin, Base):
    __tablename__ = "song_parts"

    name: Mapped[str] = mapped_column(String(80), unique=True)
    abbreviation: Mapped[str] = mapped_column(String(20), unique=True)
    sort_order: Mapped[int] = mapped_column(default=0)


class OnSongSection(IdMixin, TimestampMixin, Base):
    __tablename__ = "onsong_sections"

    song_id: Mapped[str] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"), index=True)
    song_part_id: Mapped[str | None] = mapped_column(ForeignKey("song_parts.id"), index=True)
    section_label: Mapped[str] = mapped_column(String(80))
    content: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(default=0)


class LyricsImport(IdMixin, TimestampMixin, Base):
    __tablename__ = "lyrics_imports"

    song_id: Mapped[str | None] = mapped_column(ForeignKey("songs.id"), index=True)
    provider: Mapped[str] = mapped_column(String(120), index=True)
    source_url: Mapped[str | None] = mapped_column(String(1000))
    source_label: Mapped[str | None] = mapped_column(String(220))
    status: Mapped[str] = mapped_column(String(80), default="draft")
    confidence: Mapped[str | None] = mapped_column(String(40))
    imported_text: Mapped[str | None] = mapped_column(Text)
