from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.auth import require_any_permission, require_permission
from app.modules.identity.models import User
from app.modules.sunday_school.models import SundaySchoolLesson
from app.modules.sunday_school.schemas import (
    SundaySchoolLessonCreate,
    SundaySchoolLessonRead,
    SundaySchoolLessonUpdate,
)

router = APIRouter()


def lesson_to_read(lesson: SundaySchoolLesson) -> SundaySchoolLessonRead:
    return SundaySchoolLessonRead(
        id=lesson.id,
        lesson_date=lesson.lesson_date,
        status=lesson.status,
        theme=lesson.theme,
        bible_reference=lesson.bible_reference,
        bible_story=lesson.bible_story,
        crafts=lesson.crafts,
        songs=lesson.songs,
        games=lesson.games,
        source_notes=lesson.source_notes,
        teacher_notes=lesson.teacher_notes,
        created_at=lesson.created_at,
        updated_at=lesson.updated_at,
    )


def get_lesson_or_404(session: Session, lesson_id: str) -> SundaySchoolLesson:
    lesson = session.get(SundaySchoolLesson, lesson_id)
    if lesson is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sunday school lesson not found")
    return lesson


@router.get("/lessons", response_model=list[SundaySchoolLessonRead])
def list_lessons(
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[SundaySchoolLessonRead]:
    query = select(SundaySchoolLesson)
    if from_date:
        query = query.where(SundaySchoolLesson.lesson_date >= from_date)
    if to_date:
        query = query.where(SundaySchoolLesson.lesson_date <= to_date)
    lessons = session.scalars(query.order_by(SundaySchoolLesson.lesson_date)).all()
    return [lesson_to_read(lesson) for lesson in lessons]


@router.post("/lessons", response_model=SundaySchoolLessonRead, status_code=status.HTTP_201_CREATED)
def create_lesson(
    payload: SundaySchoolLessonCreate,
    _current_user: User = Depends(require_any_permission("plans:create", "plans:edit")),
    session: Session = Depends(get_session),
) -> SundaySchoolLessonRead:
    existing = session.scalar(
        select(SundaySchoolLesson).where(SundaySchoolLesson.lesson_date == payload.lesson_date)
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A lesson already exists for this date")

    lesson = SundaySchoolLesson(**payload.model_dump())
    session.add(lesson)
    session.commit()
    session.refresh(lesson)
    return lesson_to_read(lesson)


@router.patch("/lessons/{lesson_id}", response_model=SundaySchoolLessonRead)
def update_lesson(
    lesson_id: str,
    payload: SundaySchoolLessonUpdate,
    _current_user: User = Depends(require_any_permission("plans:create", "plans:edit")),
    session: Session = Depends(get_session),
) -> SundaySchoolLessonRead:
    lesson = get_lesson_or_404(session, lesson_id)
    changes = payload.model_dump(exclude_unset=True)

    if "lesson_date" in changes and changes["lesson_date"] != lesson.lesson_date:
        existing = session.scalar(
            select(SundaySchoolLesson).where(SundaySchoolLesson.lesson_date == changes["lesson_date"])
        )
        if existing is not None and existing.id != lesson.id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A lesson already exists for this date")

    for key, value in changes.items():
        setattr(lesson, key, value)

    session.commit()
    session.refresh(lesson)
    return lesson_to_read(lesson)
