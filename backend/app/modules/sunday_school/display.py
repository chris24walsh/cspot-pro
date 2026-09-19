"""The existing authenticated HTTP display pattern, scoped to one school room.

Service sessions reference service plans and trigger sanctuary audio/recording
automation. Keep that machinery untouched: one row and an atomic revision check
provide the same durable start/control/end lifecycle for school lessons.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.auth import require_any_permission, require_permission
from app.modules.identity.models import User
from app.modules.sunday_school.models import SundaySchoolRoom

router = APIRouter()


class Verse(BaseModel):
    text: str = Field(default="", max_length=5000)
    reference: str = Field(default="", max_length=200)


class SchoolDisplayState(BaseModel):
    kind: Literal["idle", "verse", "story", "song", "text"] = "idle"
    element_id: str = ""
    title: str = Field(default="", max_length=220)
    detail: str = Field(default="", max_length=10000)
    last_week: Verse = Field(default_factory=Verse)
    this_week: Verse = Field(default_factory=Verse)
    translation: str = ""
    story_id: str = ""
    step: int = Field(default=0, ge=0, le=100)
    blanked: bool = False


class SchoolDisplayRead(BaseModel):
    lesson_date: date | None = None
    lesson_title: str = ""
    state: SchoolDisplayState = Field(default_factory=SchoolDisplayState)
    revision: int = 0
    connected: bool = False
    sound_ready: bool = False


class SchoolCommand(BaseModel):
    action: Literal["start", "present", "update", "end_element", "end"]
    lesson_date: date
    revision: int = Field(ge=0)
    lesson_title: str = Field(default="", max_length=220)
    state: SchoolDisplayState | None = None
    step: int | None = Field(default=None, ge=0, le=100)
    blanked: bool | None = None


class SchoolHeartbeat(BaseModel):
    sound_ready: bool = False


def read_room(session: Session) -> SchoolDisplayRead:
    room = session.get(SundaySchoolRoom, 1, populate_existing=True)
    if room is None:
        raise HTTPException(503, "Sunday School display is not ready.")
    connected = bool(
        room.seen_at
        and datetime.now(UTC) - room.seen_at.replace(tzinfo=UTC) < timedelta(seconds=12)
    )
    return SchoolDisplayRead(
        lesson_date=room.lesson_date,
        lesson_title=room.lesson_title,
        state=SchoolDisplayState.model_validate(room.state),
        revision=room.revision,
        connected=connected,
        sound_ready=connected and room.sound_ready,
    )


@router.get("/display", response_model=SchoolDisplayRead)
def get_school_display(
    _user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> SchoolDisplayRead:
    return read_room(session)


@router.post("/display/heartbeat", response_model=SchoolDisplayRead)
def heartbeat_school_display(
    payload: SchoolHeartbeat,
    _user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> SchoolDisplayRead:
    session.execute(
        update(SundaySchoolRoom)
        .where(SundaySchoolRoom.id == 1)
        .values(
            seen_at=datetime.now(UTC),
            sound_ready=payload.sound_ready,
        )
    )
    session.commit()
    return read_room(session)


@router.post("/display/control", response_model=SchoolDisplayRead)
def control_school_display(
    payload: SchoolCommand,
    _user: User = Depends(
        require_any_permission("sunday_school:present", "plans:create", "plans:edit")
    ),
    session: Session = Depends(get_session),
) -> SchoolDisplayRead:
    current = read_room(session)
    if payload.revision != current.revision:
        raise HTTPException(
            409, "The display changed. Your controls have been refreshed; try again."
        )
    if current.lesson_date and current.lesson_date != payload.lesson_date:
        raise HTTPException(
            409,
            f"Sunday School for {current.lesson_date} is live. End it before starting another lesson.",
        )
    if payload.action != "start" and not current.lesson_date:
        raise HTTPException(409, "Start Sunday School before presenting an element.")
    state = current.state
    lesson_date = current.lesson_date
    lesson_title = current.lesson_title
    if payload.action == "start":
        if current.lesson_date:
            return current
        lesson_date, lesson_title = payload.lesson_date, payload.lesson_title
        state = SchoolDisplayState()
    elif payload.action == "present":
        if payload.state is None or payload.state.kind == "idle" or not payload.state.element_id:
            raise HTTPException(422, "Choose an element to present.")
        state = payload.state.model_copy(update={"step": 0, "blanked": False})
    elif payload.action == "update":
        if state.kind == "idle":
            raise HTTPException(409, "Present an element first.")
        if state.kind == "verse" and payload.step is not None and payload.step > 13:
            raise HTTPException(422, "The verse game has finished.")
        state = state.model_copy(
            update={
                "step": payload.step if payload.step is not None else state.step,
                "blanked": payload.blanked if payload.blanked is not None else state.blanked,
            }
        )
    elif payload.action == "end_element":
        state = SchoolDisplayState()
    elif payload.action == "end":
        lesson_date, lesson_title, state = None, "", SchoolDisplayState()
    # The predicate is the atomic ownership check even when two starts arrive
    # together, or an old controller attempts to change a restarted lesson.
    result = session.execute(
        update(SundaySchoolRoom)
        .where(
            SundaySchoolRoom.id == 1,
            SundaySchoolRoom.revision == payload.revision,
        )
        .values(
            lesson_date=lesson_date,
            lesson_title=lesson_title,
            state=state.model_dump(),
            revision=payload.revision + 1,
        )
    )
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(409, "The display changed. Refresh and try again.")
    session.commit()
    return read_room(session)
