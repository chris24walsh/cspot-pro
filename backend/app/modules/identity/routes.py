from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.auth import (
    CurrentUser,
    clear_session_cookie,
    has_bootstrap_admin,
    list_permissions,
    list_role_names,
    require_permission,
    set_session_cookie,
)
from app.modules.identity.models import Role, User, UserRole
from app.modules.identity.schemas import (
    BootstrapAdminRequest,
    BootstrapStatusRead,
    LoginRequest,
    MemberRead,
    RoleRead,
    SessionUserRead,
    UserCreate,
    UserRead,
    UserUpdate,
)
from app.modules.identity.security import hash_password, verify_password

router = APIRouter()


def user_to_read(session: Session, user: User) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        name=user.name,
        start_page=user.start_page,
        email_confirmed=user.email_confirmed,
        active=user.active,
        roles=list_role_names(session, user.id),
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


def user_to_session_read(session: Session, user: User) -> SessionUserRead:
    base = user_to_read(session, user)
    return SessionUserRead(**base.model_dump(), permissions=list_permissions(session, user.id))


def user_to_member_read(user: User) -> MemberRead:
    return MemberRead(id=user.id, email=user.email, name=user.name, active=user.active)


@router.get("/auth/bootstrap-status", response_model=BootstrapStatusRead)
def bootstrap_status(session: Session = Depends(get_session)) -> BootstrapStatusRead:
    return BootstrapStatusRead(available=not has_bootstrap_admin(session))


@router.post("/auth/bootstrap", response_model=SessionUserRead, status_code=status.HTTP_201_CREATED)
def bootstrap_admin(
    payload: BootstrapAdminRequest,
    response: Response,
    session: Session = Depends(get_session),
) -> SessionUserRead:
    if has_bootstrap_admin(session):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Bootstrap is no longer available.")

    admin_role = session.scalar(select(Role).where(Role.name == "administrator"))
    if admin_role is None:
        admin_role = Role(
            name="administrator",
            description="Manage users, roles, and all content.",
            system_role=True,
        )
        session.add(admin_role)
        session.flush()

    user = session.scalar(select(User).where(User.email == payload.email))
    if user is None:
        user = User(
            email=payload.email,
            name=payload.name,
            start_page="presentation",
            email_confirmed=True,
            active=True,
            password_hash=hash_password(payload.password),
        )
        session.add(user)
        session.flush()
    else:
        user.name = payload.name
        user.active = True
        user.email_confirmed = True
        user.password_hash = hash_password(payload.password)

    set_user_roles(session, user, ["administrator"])
    session.commit()
    session.refresh(user)
    set_session_cookie(response, user_id=user.id)
    return user_to_session_read(session, user)


@router.post("/auth/login", response_model=SessionUserRead)
def login(
    payload: LoginRequest,
    response: Response,
    session: Session = Depends(get_session),
) -> SessionUserRead:
    user = session.scalar(select(User).where(User.email == payload.email))
    if user is None or not user.active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

    set_session_cookie(response, user_id=user.id)
    return user_to_session_read(session, user)


@router.delete("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> Response:
    clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/auth/me", response_model=SessionUserRead)
def get_session_user(
    current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> SessionUserRead:
    return user_to_session_read(session, current_user)


@router.get("/roles", response_model=list[RoleRead])
def list_roles(
    _current_user: CurrentUser = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> list[RoleRead]:
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
def list_users(
    _current_user: CurrentUser = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> list[UserRead]:
    users = session.scalars(select(User).order_by(User.name)).all()
    return [user_to_read(session, user) for user in users]


@router.get("/members", response_model=list[MemberRead])
def list_members(
    _current_user: CurrentUser = Depends(require_permission("team:read")),
    session: Session = Depends(get_session),
) -> list[MemberRead]:
    users = session.scalars(select(User).where(User.active.is_(True)).order_by(User.name)).all()
    return [user_to_member_read(user) for user in users]


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    _current_user: CurrentUser = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> UserRead:
    user = User(
        email=payload.email,
        name=payload.name,
        start_page=payload.start_page,
        email_confirmed=payload.email_confirmed,
        active=payload.active,
        password_hash=hash_password(payload.password) if payload.password else None,
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
def get_user(
    user_id: str,
    _current_user: CurrentUser = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> UserRead:
    return user_to_read(session, get_user_or_404(session, user_id))


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(
    user_id: str,
    payload: UserUpdate,
    _current_user: CurrentUser = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> UserRead:
    user = get_user_or_404(session, user_id)
    values = payload.model_dump(exclude_unset=True)
    role_names = values.pop("role_names", None)
    password = values.pop("password", None)

    for field, value in values.items():
        setattr(user, field, value)

    if password:
        user.password_hash = hash_password(password)

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
def deactivate_user(
    user_id: str,
    _current_user: CurrentUser = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> Response:
    user = get_user_or_404(session, user_id)
    user.active = False
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
