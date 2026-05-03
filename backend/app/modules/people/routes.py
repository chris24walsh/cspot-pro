from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.auth import CurrentUser, require_any_permission, require_permission
from app.modules.identity.models import User
from app.modules.people.models import Instrument, TeamAssignment
from app.modules.people.schemas import (
    InstrumentRead,
    TeamAssignmentCreate,
    TeamAssignmentRead,
    TeamAssignmentUpdate,
)
from app.modules.planning.models import Plan
from app.modules.planning.routes import get_plan_or_404

router = APIRouter()


def assignment_to_read(session: Session, assignment: TeamAssignment) -> TeamAssignmentRead:
    user = session.get(User, assignment.user_id) if assignment.user_id else None
    instrument = session.get(Instrument, assignment.instrument_id) if assignment.instrument_id else None
    return TeamAssignmentRead(
        id=assignment.id,
        plan_id=assignment.plan_id,
        user_id=assignment.user_id,
        user_name=user.name if user else None,
        role_label=assignment.role_label,
        instrument_id=assignment.instrument_id,
        instrument_name=instrument.name if instrument else None,
        status=assignment.status,
        notes=assignment.notes,
        confirmed=assignment.status == "confirmed",
        requested=assignment.status in {"requested", "confirmed"},
        available=assignment.status != "unavailable",
    )


def get_assignment_or_404(session: Session, assignment_id: str) -> TeamAssignment:
    assignment = session.get(TeamAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team assignment not found")
    return assignment


@router.get("/instruments", response_model=list[InstrumentRead])
def list_instruments(
    _current_user: CurrentUser = Depends(require_permission("team:read")),
    session: Session = Depends(get_session),
) -> list[InstrumentRead]:
    instruments = session.scalars(select(Instrument).order_by(Instrument.sort_order, Instrument.name)).all()
    return [
        InstrumentRead(id=instrument.id, name=instrument.name, sort_order=instrument.sort_order)
        for instrument in instruments
    ]


@router.get("/plans/{plan_id}/team", response_model=list[TeamAssignmentRead])
def list_team_assignments(
    plan_id: str,
    _current_user: CurrentUser = Depends(require_permission("team:read")),
    session: Session = Depends(get_session),
) -> list[TeamAssignmentRead]:
    get_plan_or_404(session, plan_id)
    assignments = session.scalars(
        select(TeamAssignment).where(TeamAssignment.plan_id == plan_id).order_by(
            TeamAssignment.role_label,
            TeamAssignment.created_at,
        )
    ).all()
    return [assignment_to_read(session, assignment) for assignment in assignments]


@router.post(
    "/plans/{plan_id}/team",
    response_model=TeamAssignmentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_team_assignment(
    plan_id: str,
    payload: TeamAssignmentCreate,
    _current_user: CurrentUser = Depends(require_any_permission("team:edit", "plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> TeamAssignmentRead:
    get_plan_or_404(session, plan_id)
    if payload.plan_id != plan_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Plan mismatch")

    assignment = TeamAssignment(**payload.model_dump())
    session.add(assignment)
    session.commit()
    session.refresh(assignment)
    return assignment_to_read(session, assignment)


@router.patch("/team/{assignment_id}", response_model=TeamAssignmentRead)
def update_team_assignment(
    assignment_id: str,
    payload: TeamAssignmentUpdate,
    _current_user: CurrentUser = Depends(require_any_permission("team:edit", "plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> TeamAssignmentRead:
    assignment = get_assignment_or_404(session, assignment_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(assignment, field, value)

    if assignment.status == "confirmed" and assignment.confirmed_at is None:
        assignment.confirmed_at = datetime.now(UTC)
    elif assignment.status != "confirmed":
        assignment.confirmed_at = None

    session.commit()
    session.refresh(assignment)
    return assignment_to_read(session, assignment)


@router.delete("/team/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_team_assignment(
    assignment_id: str,
    _current_user: CurrentUser = Depends(require_any_permission("team:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> Response:
    assignment = get_assignment_or_404(session, assignment_id)
    session.delete(assignment)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
