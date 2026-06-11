from datetime import date

from sqlalchemy import Date, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class SundaySchoolLesson(IdMixin, TimestampMixin, Base):
    __tablename__ = "sunday_school_lessons"

    lesson_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(40), default="draft")
    theme: Mapped[str] = mapped_column(String(220), default="")
    bible_reference: Mapped[str] = mapped_column(String(160), default="")
    bible_story: Mapped[str] = mapped_column(Text, default="")
    crafts: Mapped[str] = mapped_column(Text, default="")
    songs: Mapped[str] = mapped_column(Text, default="")
    games: Mapped[str] = mapped_column(Text, default="")
    source_notes: Mapped[str] = mapped_column(Text, default="")
    teacher_notes: Mapped[str] = mapped_column(Text, default="")
