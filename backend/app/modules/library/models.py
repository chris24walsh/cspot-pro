from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class Resource(IdMixin, TimestampMixin, Base):
    __tablename__ = "resources"

    name: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    resource_type: Mapped[str | None] = mapped_column(String(80))


class PlanResource(IdMixin, TimestampMixin, Base):
    __tablename__ = "plan_resources"

    plan_id: Mapped[str] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    resource_id: Mapped[str] = mapped_column(ForeignKey("resources.id"), index=True)
    notes: Mapped[str | None] = mapped_column(Text)


class FileCategory(IdMixin, TimestampMixin, Base):
    __tablename__ = "file_categories"

    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)


class StoredFile(IdMixin, TimestampMixin, Base):
    __tablename__ = "files"

    category_id: Mapped[str | None] = mapped_column(ForeignKey("file_categories.id"), index=True)
    song_id: Mapped[str | None] = mapped_column(ForeignKey("songs.id"), index=True)
    uploaded_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    display_name: Mapped[str] = mapped_column(String(220))
    storage_path: Mapped[str] = mapped_column(String(1000))
    content_type: Mapped[str | None] = mapped_column(String(160))
    checksum: Mapped[str | None] = mapped_column(String(128))
    flatten_builds: Mapped[bool] = mapped_column(Boolean, default=False)


class ItemFile(IdMixin, TimestampMixin, Base):
    __tablename__ = "item_files"

    plan_item_id: Mapped[str] = mapped_column(
        ForeignKey("plan_items.id", ondelete="CASCADE"),
        index=True,
    )
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(default=0)
    persistent: Mapped[bool] = mapped_column(Boolean, default=False)


class BibleVersion(IdMixin, TimestampMixin, Base):
    __tablename__ = "bible_versions"

    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(180))
    language: Mapped[str | None] = mapped_column(String(80))
    license: Mapped[str | None] = mapped_column(String(120))


class BibleBook(IdMixin, TimestampMixin, Base):
    __tablename__ = "bible_books"

    name: Mapped[str] = mapped_column(String(120), index=True)
    abbreviation: Mapped[str] = mapped_column(String(20), index=True)
    testament: Mapped[str] = mapped_column(String(20))
    sort_order: Mapped[int]


class BibleVerse(IdMixin, TimestampMixin, Base):
    __tablename__ = "bible_verses"

    version_id: Mapped[str] = mapped_column(ForeignKey("bible_versions.id"), index=True)
    book_id: Mapped[str] = mapped_column(ForeignKey("bible_books.id"), index=True)
    chapter: Mapped[int] = mapped_column(index=True)
    verse: Mapped[int] = mapped_column(index=True)
    text: Mapped[str] = mapped_column(Text)
