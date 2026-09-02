import json
from datetime import date
from io import BytesIO
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, StreamingResponse
from pypdf import PdfReader, PdfWriter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.auth import require_any_permission, require_permission
from app.modules.identity.models import User
from app.modules.planning.models import HistoryEntry
from app.modules.sunday_school.importer import import_resources_from_default_roots
from app.modules.sunday_school.models import SundaySchoolLesson, SundaySchoolResource
from app.modules.sunday_school.schemas import (
    SundaySchoolHistoryRead,
    SundaySchoolImportRead,
    SundaySchoolLessonCreate,
    SundaySchoolLessonRead,
    SundaySchoolLessonUpdate,
    SundaySchoolResourceRead,
)

router = APIRouter()
LESSON_HISTORY_ENTITY_TYPE = "sunday_school_lesson"
LESSON_HISTORY_ACTION = "lesson_snapshot"


def lesson_to_read(lesson: SundaySchoolLesson) -> SundaySchoolLessonRead:
    return SundaySchoolLessonRead(
        id=lesson.id,
        lesson_date=lesson.lesson_date,
        status=lesson.status,
        teacher_name=lesson.teacher_name,
        theme=lesson.theme,
        bible_reference=lesson.bible_reference,
        bible_story=lesson.bible_story,
        crafts=lesson.crafts,
        songs=lesson.songs,
        games=lesson.games,
        source_notes=lesson.source_notes,
        teacher_notes=lesson.teacher_notes,
        board_items=lesson.board_items or [],
        created_at=lesson.created_at,
        updated_at=lesson.updated_at,
    )


def get_lesson_or_404(session: Session, lesson_id: str) -> SundaySchoolLesson:
    lesson = session.get(SundaySchoolLesson, lesson_id)
    if lesson is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sunday school lesson not found",
        )
    return lesson


def lesson_history_snapshot(lesson: SundaySchoolLesson) -> dict[str, object]:
    return SundaySchoolLessonCreate.model_validate(lesson, from_attributes=True).model_dump(
        mode="json"
    )


@router.get("/lessons/{lesson_id}/history", response_model=list[SundaySchoolHistoryRead])
def list_lesson_history(
    lesson_id: str,
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[SundaySchoolHistoryRead]:
    get_lesson_or_404(session, lesson_id)
    entries = session.scalars(
        select(HistoryEntry).where(
            HistoryEntry.entity_type == LESSON_HISTORY_ENTITY_TYPE,
            HistoryEntry.entity_id == lesson_id,
            HistoryEntry.action == LESSON_HISTORY_ACTION,
        ).order_by(HistoryEntry.created_at.desc()).limit(100)
    ).all()
    result: list[SundaySchoolHistoryRead] = []
    for entry in entries:
        try:
            details = json.loads(entry.details or "{}")
        except json.JSONDecodeError:
            continue
        actor = session.get(User, entry.actor_id) if entry.actor_id else None
        result.append(SundaySchoolHistoryRead(
            id=entry.id,
            actor_name=actor.name if actor else None,
            created_at=entry.created_at,
            label=details.get("label", "Lesson edited"),
            before=details.get("before", {}),
            after=details.get("after", {}),
        ))
    return list(reversed(result))


def resource_to_read(resource: SundaySchoolResource) -> SundaySchoolResourceRead:
    return SundaySchoolResourceRead(
        id=resource.id,
        title=resource.title,
        resource_type=resource.resource_type,
        age_group=resource.age_group,
        source_title=resource.source_title,
        theme=resource.theme,
        bible_reference=resource.bible_reference,
        lesson_date=resource.lesson_date,
        week_number=resource.week_number,
        translation=resource.translation,
        file_name=resource.file_name,
        file_path=resource.file_path,
        page_start=resource.page_start,
        page_end=resource.page_end,
        summary=resource.summary,
        sort_order=resource.sort_order,
        created_at=resource.created_at,
        updated_at=resource.updated_at,
    )


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
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A lesson already exists for this date",
        )

    lesson = SundaySchoolLesson(**payload.model_dump())
    session.add(lesson)
    session.commit()
    session.refresh(lesson)
    return lesson_to_read(lesson)


@router.get("/resources", response_model=list[SundaySchoolResourceRead])
def list_resources(
    lesson_date: date | None = Query(default=None),
    week_number: int | None = Query(default=None),
    age_group: str | None = Query(default=None),
    resource_type: str | None = Query(default=None),
    query: str | None = Query(default=None),
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[SundaySchoolResourceRead]:
    resource_query = select(SundaySchoolResource)
    if lesson_date:
        resource_query = resource_query.where(SundaySchoolResource.lesson_date == lesson_date)
    if week_number:
        resource_query = resource_query.where(SundaySchoolResource.week_number == week_number)
    if age_group:
        resource_query = resource_query.where(SundaySchoolResource.age_group == age_group)
    if resource_type:
        resource_query = resource_query.where(SundaySchoolResource.resource_type == resource_type)
    if query:
        pattern = f"%{query.strip()}%"
        resource_query = resource_query.where(
            SundaySchoolResource.title.ilike(pattern)
            | SundaySchoolResource.theme.ilike(pattern)
            | SundaySchoolResource.bible_reference.ilike(pattern)
            | SundaySchoolResource.summary.ilike(pattern)
        )
    resources = session.scalars(
        resource_query.order_by(
            SundaySchoolResource.lesson_date,
            SundaySchoolResource.week_number,
            SundaySchoolResource.sort_order,
            SundaySchoolResource.title,
        )
    ).all()
    return [resource_to_read(resource) for resource in resources]


@router.post("/resources/import-local", response_model=SundaySchoolImportRead)
def import_local_resources(
    _current_user: User = Depends(require_any_permission("plans:create", "plans:edit")),
    session: Session = Depends(get_session),
) -> SundaySchoolImportRead:
    result = import_resources_from_default_roots(session)
    return SundaySchoolImportRead(scanned=result.scanned, imported=result.imported)


@router.get("/resources/{resource_id}/file")
def open_resource_file(
    resource_id: str,
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
):
    resource = session.get(SundaySchoolResource, resource_id)
    if resource is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sunday school resource not found",
        )
    path = Path(resource.file_path)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource file is not available",
        )
    if resource.page_start and resource.page_end:
        try:
            reader = PdfReader(str(path))
            page_start = max(resource.page_start, 1)
            page_end = min(resource.page_end, len(reader.pages))
            if page_start <= page_end:
                writer = PdfWriter()
                for page_index in range(page_start - 1, page_end):
                    writer.add_page(reader.pages[page_index])
                output = BytesIO()
                writer.write(output)
                output.seek(0)
                suffix = f"p{page_start}" if page_start == page_end else f"p{page_start}-{page_end}"
                filename = f"{path.stem}-{suffix}.pdf"
                return StreamingResponse(
                    output,
                    media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{filename}"'},
                )
        except Exception:
            pass
    return FileResponse(path, filename=resource.file_name, media_type="application/pdf")


@router.patch("/lessons/{lesson_id}", response_model=SundaySchoolLessonRead)
def update_lesson(
    lesson_id: str,
    payload: SundaySchoolLessonUpdate,
    current_user: User = Depends(require_any_permission("plans:create", "plans:edit")),
    session: Session = Depends(get_session),
) -> SundaySchoolLessonRead:
    lesson = get_lesson_or_404(session, lesson_id)
    changes = payload.model_dump(exclude_unset=True)
    before = lesson_history_snapshot(lesson)

    if "lesson_date" in changes and changes["lesson_date"] != lesson.lesson_date:
        existing = session.scalar(
            select(SundaySchoolLesson).where(
                SundaySchoolLesson.lesson_date == changes["lesson_date"]
            )
        )
        if existing is not None and existing.id != lesson.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A lesson already exists for this date",
            )

    for key, value in changes.items():
        setattr(lesson, key, value)

    after = lesson_history_snapshot(lesson)
    changed_fields = [
        field.replace("_", " ")
        for field in changes
        if before.get(field) != after.get(field)
    ]
    if changed_fields:
        label = (
            changed_fields[0].capitalize()
            if len(changed_fields) == 1
            else f"Edited {len(changed_fields)} lesson fields"
        )
        session.add(
            HistoryEntry(
                actor_id=current_user.id,
                entity_type=LESSON_HISTORY_ENTITY_TYPE,
                entity_id=lesson.id,
                action=LESSON_HISTORY_ACTION,
                details=json.dumps(
                    {"label": label, "before": before, "after": after},
                    separators=(",", ":"),
                ),
            )
        )

    session.commit()
    session.refresh(lesson)
    return lesson_to_read(lesson)
