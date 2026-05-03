from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.models import Role, User, UserRole
from app.modules.identity.schemas import RoleRead, UserCreate, UserRead, UserUpdate

router = APIRouter()


def user_roles(session: Session, user_id: str) -> list[str]:
    return list(
        session.scalars(
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user_id)
            .order_by(Role.name)
        )
    )


def user_to_read(session: Session, user: User) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        name=user.name,
        start_page=user.start_page,
        email_confirmed=user.email_confirmed,
        active=user.active,
        roles=user_roles(session, user.id),
    )


def get_user_or_404(session: Session, user_id: str) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def set_user_roles(session: Session, user: User, role_names: list[str]) -> None:
    roles = session.scalars(select(Role).where(Role.name.in_(role_names))).all()
    found_names = {role.name for role in roles}
    missing = sorted(set(role_names) - found_names)

    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown roles: {', '.join(missing)}",
        )

    existing = session.scalars(select(UserRole).where(UserRole.user_id == user.id)).all()
    for assignment in existing:
        session.delete(assignment)
    session.flush()

    for role in roles:
        session.add(UserRole(user_id=user.id, role_id=role.id))


@router.get("/roles", response_model=list[RoleRead])
def list_roles(session: Session = Depends(get_session)) -> list[RoleRead]:
    roles = session.scalars(select(Role).order_by(Role.name)).all()
    return [
        RoleRead(
            id=role.id,
            name=role.name,
            description=role.description,
            system_role=role.system_role,
        )
        for role in roles
    ]


@router.get("/users", response_model=list[UserRead])
def list_users(session: Session = Depends(get_session)) -> list[UserRead]:
    users = session.scalars(select(User).order_by(User.name)).all()
    return [user_to_read(session, user) for user in users]


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, session: Session = Depends(get_session)) -> UserRead:
    user = User(
        email=payload.email,
        name=payload.name,
        start_page=payload.start_page,
        email_confirmed=payload.email_confirmed,
        active=payload.active,
        password_hash=None,
    )
    session.add(user)
    session.flush()
    set_user_roles(session, user, payload.role_names)

    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists.",
        ) from exc

    session.refresh(user)
    return user_to_read(session, user)


@router.get("/users/{user_id}", response_model=UserRead)
def get_user(user_id: str, session: Session = Depends(get_session)) -> UserRead:
    return user_to_read(session, get_user_or_404(session, user_id))


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(
    user_id: str,
    payload: UserUpdate,
    session: Session = Depends(get_session),
) -> UserRead:
    user = get_user_or_404(session, user_id)
    values = payload.model_dump(exclude_unset=True)
    role_names = values.pop("role_names", None)

    for field, value in values.items():
        setattr(user, field, value)

    if role_names is not None:
        set_user_roles(session, user, role_names)

    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists.",
        ) from exc

    session.refresh(user)
    return user_to_read(session, user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(user_id: str, session: Session = Depends(get_session)) -> Response:
    user = get_user_or_404(session, user_id)
    user.active = False
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
