from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_session
from app.core.email import send_email, smtp_enabled
from app.modules.identity.auth import (
    CurrentUser,
    clear_session_cookie,
    has_bootstrap_admin,
    list_permissions,
    list_role_names,
    require_permission,
    set_session_cookie,
)
from app.modules.identity.models import AuthToken, Role, User, UserRole
from app.modules.identity.permissions import ROLE_DEFINITIONS, canonical_role_names
from app.modules.identity.schemas import (
    AuthActionCompleteRequest,
    AuthActionTokenRead,
    BootstrapAdminRequest,
    BootstrapStatusRead,
    LoginRequest,
    MemberRead,
    PasswordResetAdminRead,
    PasswordResetRequest,
    RoleRead,
    SessionUserRead,
    UserCreate,
    UserInviteRead,
    UserInviteRequest,
    UserRead,
    UserUpdate,
)
from app.modules.identity.security import (
    generate_auth_token,
    hash_auth_token,
    hash_password,
    validate_password_strength,
    verify_password,
)

router = APIRouter()


def ensure_system_roles(session: Session) -> None:
    existing_roles = {
        role.name: role
        for role in session.scalars(select(Role).where(Role.name.in_(tuple(ROLE_DEFINITIONS.keys())))).all()
    }

    for role_name, definition in ROLE_DEFINITIONS.items():
        role = existing_roles.get(role_name)
        description = str(definition["description"])
        if role is None:
            session.add(Role(name=role_name, description=description, system_role=True))
            continue

        role.description = description
        role.system_role = True


def user_to_read(session: Session, user: User) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        name=user.name,
        start_page=user.start_page,
        email_confirmed=user.email_confirmed,
        active=user.active,
        roles=list_role_names(session, user.id),
        password_set=bool(user.password_hash),
        invite_pending=not bool(user.password_hash),
    )


def get_user_or_404(session: Session, user_id: str) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def set_user_roles(session: Session, user: User, role_names: list[str]) -> None:
    normalized_role_names = canonical_role_names(role_names)
    ensure_system_roles(session)
    session.flush()
    roles = session.scalars(select(Role).where(Role.name.in_(normalized_role_names))).all()
    found_names = {role.name for role in roles}
    missing = sorted(set(normalized_role_names) - found_names)

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


def build_public_app_url() -> str:
    if not settings.public_app_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="PUBLIC_APP_URL must be configured for invitation and reset links.",
        )
    return settings.public_app_url.rstrip("/")


def expire_existing_tokens(session: Session, *, user_id: str, purpose: str) -> None:
    now = datetime.now(UTC)
    tokens = session.scalars(
        select(AuthToken).where(
            AuthToken.user_id == user_id,
            AuthToken.purpose == purpose,
            AuthToken.used_at.is_(None),
        )
    ).all()
    for token in tokens:
        token.used_at = now


def issue_auth_token(
    session: Session,
    *,
    user: User,
    purpose: str,
    created_by_user_id: str | None,
    lifetime_hours: int,
) -> tuple[AuthToken, str]:
    expire_existing_tokens(session, user_id=user.id, purpose=purpose)
    raw_token = generate_auth_token()
    auth_token = AuthToken(
        user_id=user.id,
        created_by_user_id=created_by_user_id,
        purpose=purpose,
        token_hash=hash_auth_token(raw_token),
        sent_to_email=user.email,
        expires_at=datetime.now(UTC) + timedelta(hours=lifetime_hours),
    )
    session.add(auth_token)
    session.flush()
    return auth_token, raw_token


def build_auth_action_url(*, purpose: str, token: str) -> str:
    return f"{build_public_app_url()}/?auth_action={purpose}&token={token}"


def send_auth_email(*, user: User, purpose: str, action_url: str) -> bool:
    if purpose == "invite":
        subject = f"You're invited to join {settings.app_name}"
        body = (
            f"Hello {user.name},\n\n"
            f"You've been invited to join {settings.app_name}.\n\n"
            f"Set your password here:\n{action_url}\n\n"
            f"This link will expire soon."
        )
    else:
        subject = f"Reset your {settings.app_name} password"
        body = (
            f"Hello {user.name},\n\n"
            f"We received a request to reset your password.\n\n"
            f"Set a new password here:\n{action_url}\n\n"
            f"If you didn't request this, you can ignore this email."
        )

    return send_email(to_email=user.email, subject=subject, text_body=body)


def get_valid_auth_token_or_404(session: Session, raw_token: str) -> AuthToken:
    auth_token = session.scalar(select(AuthToken).where(AuthToken.token_hash == hash_auth_token(raw_token)))
    if auth_token is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found.")
    if auth_token.used_at is not None or auth_token.expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Token has expired.")
    return auth_token


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

    try:
        validate_password_strength(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    ensure_system_roles(session)
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


@router.get("/auth/action-token", response_model=AuthActionTokenRead)
def get_auth_action_token(
    token: str,
    session: Session = Depends(get_session),
) -> AuthActionTokenRead:
    auth_token = get_valid_auth_token_or_404(session, token)
    user = get_user_or_404(session, auth_token.user_id)
    return AuthActionTokenRead(
        purpose=auth_token.purpose,
        email=user.email,
        name=user.name,
        expires_at=auth_token.expires_at,
    )


@router.post("/auth/action-token/complete", response_model=SessionUserRead)
def complete_auth_action(
    payload: AuthActionCompleteRequest,
    response: Response,
    session: Session = Depends(get_session),
) -> SessionUserRead:
    try:
        validate_password_strength(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    auth_token = get_valid_auth_token_or_404(session, payload.token)
    user = get_user_or_404(session, auth_token.user_id)
    user.password_hash = hash_password(payload.password)
    user.email_confirmed = True
    user.active = True
    auth_token.used_at = datetime.now(UTC)
    session.commit()
    session.refresh(user)
    set_session_cookie(response, user_id=user.id)
    return user_to_session_read(session, user)


@router.post("/auth/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
def request_password_reset(
    payload: PasswordResetRequest,
    session: Session = Depends(get_session),
) -> dict[str, str]:
    user = session.scalar(select(User).where(User.email == payload.email, User.active.is_(True)))
    if user is not None:
        _auth_token, raw_token = issue_auth_token(
            session,
            user=user,
            purpose="reset",
            created_by_user_id=None,
            lifetime_hours=settings.auth_reset_hours,
        )
        action_url = build_auth_action_url(purpose="reset", token=raw_token)
        if smtp_enabled():
            send_auth_email(user=user, purpose="reset", action_url=action_url)
        session.commit()

    return {"detail": "If that account exists, a reset link has been sent."}


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
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> list[RoleRead]:
    ensure_system_roles(session)
    session.flush()
    role_names = tuple(ROLE_DEFINITIONS.keys())
    roles = session.scalars(select(Role).where(Role.name.in_(role_names))).all()
    role_lookup = {role.name: role for role in roles}
    return [
        RoleRead(
            id=role_lookup[role_name].id,
            name=role_lookup[role_name].name,
            description=role_lookup[role_name].description,
            system_role=role_lookup[role_name].system_role,
        )
        for role_name in ROLE_DEFINITIONS
        if role_name in role_lookup
    ]


@router.get("/users", response_model=list[UserRead])
def list_users(
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> list[UserRead]:
    users = session.scalars(select(User).order_by(User.name)).all()
    return [user_to_read(session, user) for user in users]


@router.get("/members", response_model=list[MemberRead])
def list_members(
    _current_user: User = Depends(require_permission("team:read")),
    session: Session = Depends(get_session),
) -> list[MemberRead]:
    users = session.scalars(select(User).where(User.active.is_(True)).order_by(User.name)).all()
    return [user_to_member_read(user) for user in users]


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> UserRead:
    if payload.password:
        try:
            validate_password_strength(payload.password)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    try:
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
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists.",
        ) from exc

    session.refresh(user)
    return user_to_read(session, user)


@router.post("/users/invite", response_model=UserInviteRead, status_code=status.HTTP_201_CREATED)
def invite_user(
    payload: UserInviteRequest,
    current_user: CurrentUser,
    _permission_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> UserInviteRead:
    try:
        user = User(
            email=payload.email,
            name=payload.name,
            start_page=payload.start_page,
            email_confirmed=False,
            active=payload.active,
            password_hash=None,
        )
        session.add(user)
        session.flush()
        set_user_roles(session, user, payload.role_names)
        auth_token, raw_token = issue_auth_token(
            session,
            user=user,
            purpose="invite",
            created_by_user_id=current_user.id,
            lifetime_hours=settings.auth_invite_hours,
        )
        action_url = build_auth_action_url(purpose="invite", token=raw_token)
        email_sent = smtp_enabled() and send_auth_email(user=user, purpose="invite", action_url=action_url)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists.",
        ) from exc

    session.refresh(user)
    return UserInviteRead(
        user=user_to_read(session, user),
        invitation_url=action_url,
        email_sent=email_sent,
        expires_at=auth_token.expires_at,
    )


@router.get("/users/{user_id}", response_model=UserRead)
def get_user(
    user_id: str,
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> UserRead:
    return user_to_read(session, get_user_or_404(session, user_id))


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(
    user_id: str,
    payload: UserUpdate,
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> UserRead:
    user = get_user_or_404(session, user_id)
    values = payload.model_dump(exclude_unset=True)
    role_names = values.pop("role_names", None)
    password = values.pop("password", None)

    if password:
        try:
            validate_password_strength(password)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    try:
        for field, value in values.items():
            setattr(user, field, value)

        if password:
            user.password_hash = hash_password(password)

        if role_names is not None:
            set_user_roles(session, user, role_names)

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
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> Response:
    user = get_user_or_404(session, user_id)
    user.active = False
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/users/{user_id}/invite", response_model=UserInviteRead)
def resend_invite(
    user_id: str,
    current_user: CurrentUser,
    _permission_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> UserInviteRead:
    user = get_user_or_404(session, user_id)
    auth_token, raw_token = issue_auth_token(
        session,
        user=user,
        purpose="invite",
        created_by_user_id=current_user.id,
        lifetime_hours=settings.auth_invite_hours,
    )
    action_url = build_auth_action_url(purpose="invite", token=raw_token)
    email_sent = smtp_enabled() and send_auth_email(user=user, purpose="invite", action_url=action_url)
    session.commit()
    return UserInviteRead(
        user=user_to_read(session, user),
        invitation_url=action_url,
        email_sent=email_sent,
        expires_at=auth_token.expires_at,
    )


@router.post("/users/{user_id}/password-reset", response_model=PasswordResetAdminRead)
def admin_password_reset(
    user_id: str,
    current_user: CurrentUser,
    _permission_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> PasswordResetAdminRead:
    user = get_user_or_404(session, user_id)
    auth_token, raw_token = issue_auth_token(
        session,
        user=user,
        purpose="reset",
        created_by_user_id=current_user.id,
        lifetime_hours=settings.auth_reset_hours,
    )
    action_url = build_auth_action_url(purpose="reset", token=raw_token)
    email_sent = smtp_enabled() and send_auth_email(user=user, purpose="reset", action_url=action_url)
    session.commit()
    return PasswordResetAdminRead(
        reset_url=action_url,
        email_sent=email_sent,
        expires_at=auth_token.expires_at,
    )
