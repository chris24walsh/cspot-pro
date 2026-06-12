from datetime import date

from sqlalchemy import Date, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class SundaySchoolLesson(IdMixin, TimestampMixin, Base):
    __tablename__ = "sunday_school_lessons"

    lesson_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(40), default="draft")
    teacher_name: Mapped[str] = mapped_column(String(120), default="")
    theme: Mapped[str] = mapped_column(String(220), default="")
    bible_reference: Mapped[str] = mapped_column(String(160), default="")
    bible_story: Mapped[str] = mapped_column(Text, default="")
    crafts: Mapped[str] = mapped_column(Text, default="")
    songs: Mapped[str] = mapped_column(Text, default="")
    games: Mapped[str] = mapped_column(Text, default="")
    source_notes: Mapped[str] = mapped_column(Text, default="")
    teacher_notes: Mapped[str] = mapped_column(Text, default="")


class SundaySchoolResource(IdMixin, TimestampMixin, Base):
    __tablename__ = "sunday_school_resources"
    __table_args__ = (
        UniqueConstraint(
            "file_path",
            "resource_type",
            "translation",
            name="uq_sunday_school_resource_file_type_translation",
        ),
    )

    title: Mapped[str] = mapped_column(String(220), index=True)
    resource_type: Mapped[str] = mapped_column(String(60), index=True)
    age_group: Mapped[str] = mapped_column(String(40), default="", index=True)
    source_title: Mapped[str] = mapped_column(String(220), default="")
    theme: Mapped[str] = mapped_column(String(220), default="")
    bible_reference: Mapped[str] = mapped_column(String(160), default="")
    lesson_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    week_number: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    translation: Mapped[str] = mapped_column(String(20), default="")
    file_name: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
