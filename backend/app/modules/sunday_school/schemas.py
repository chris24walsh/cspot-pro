from datetime import date, datetime

from pydantic import BaseModel


class SundaySchoolLessonBase(BaseModel):
    lesson_date: date
    status: str = "draft"
    teacher_name: str = ""
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
    teacher_name: str | None = None
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


class SundaySchoolResourceRead(BaseModel):
    id: str
    title: str
    resource_type: str
    age_group: str
    source_title: str
    theme: str
    bible_reference: str
    lesson_date: date | None
    week_number: int | None
    translation: str
    file_name: str
    file_path: str
    page_start: int | None = None
    page_end: int | None = None
    summary: str
    sort_order: int
    created_at: datetime
    updated_at: datetime


class SundaySchoolImportRead(BaseModel):
    scanned: int
    imported: int
