from datetime import date, datetime

from pydantic import BaseModel


class SundaySchoolLessonBase(BaseModel):
    lesson_date: date
    status: str = "draft"
    theme: str = ""
    bible_reference: str = ""
    bible_story: str = ""
    crafts: str = ""
    songs: str = ""
    games: str = ""
    source_notes: str = ""
    teacher_notes: str = ""


class SundaySchoolLessonCreate(SundaySchoolLessonBase):
    pass


class SundaySchoolLessonUpdate(BaseModel):
    lesson_date: date | None = None
    status: str | None = None
    theme: str | None = None
    bible_reference: str | None = None
    bible_story: str | None = None
    crafts: str | None = None
    songs: str | None = None
    games: str | None = None
    source_notes: str | None = None
    teacher_notes: str | None = None


class SundaySchoolLessonRead(SundaySchoolLessonBase):
    id: str
    created_at: datetime
    updated_at: datetime
