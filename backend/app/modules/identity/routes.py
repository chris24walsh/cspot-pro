import re
from datetime import UTC, datetime, timedelta
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_session
from app.core.email import send_email, smtp_enabled
from app.core.rate_limit import enforce_rate_limit
from app.modules.identity.auth import (
    CurrentUser,
    clear_session_cookie,
    has_bootstrap_admin,
    list_authorization_role_names,
    list_permissions,
    list_role_names,
    require_permission,
    set_session_cookie,
)
from app.modules.identity.models import (
    AuthToken,
    Role,
    ServingArea,
    User,
    UserRole,
    VolunteerPreference,
    VolunteerUnavailability,
)
from app.modules.identity.permissions import (
    ROLE_DEFINITIONS,
    SERVING_AREA_LEGACY_ROLES,
    canonical_role_names,
)
from app.modules.identity.schemas import (
    AuthActionCompleteRequest,
    AuthActionTokenRead,
    BootstrapAdminRequest,
    BootstrapStatusRead,
    EmailTestRead,
    EmailTestRequest,
    EmailVerificationRequest,
    LoginRequest,
    MemberRead,
    PasswordResetAdminRead,
    PasswordResetRequest,
    RoleRead,
    SelfProfileUpdate,
    SelfRegistrationRequest,
    SelfRegistrationResultRead,
    SelfRegistrationStatusRead,
    ServingAreaRead,
    ServingProfileRead,
    SessionUserRead,
    UserCreate,
    UserInviteRead,
    UserInviteRequest,
    UserRead,
    UserUpdate,
    VolunteerAdminRead,
    VolunteerDecisionUpdate,
    VolunteerPreferenceRead,
    VolunteerPreferenceUpdate,
    VolunteerReviewUpdate,
    VolunteerUnavailabilityCreate,
    VolunteerUnavailabilityRead,
)
from app.modules.identity.security import (
    generate_auth_token,
    hash_auth_token,
    hash_password,
    validate_password_strength,
    verify_password,
)
from app.modules.site.models import SiteContentBlock

router = APIRouter()
CALENDAR_COLORS = ("teacher-a", "teacher-b", "teacher-c", "teacher-d", "teacher-e", "teacher-f")
USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{1,79}$")


def resolve_username(
    session: Session,
    *,
    username: str | None,
    email: str,
    name: str | None = None,
    exclude_user_id: str | None = None,
) -> str:
    if username and username.strip():
        candidate = username.strip().lower()
        if not USERNAME_PATTERN.fullmatch(candidate):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "Username must be 2-80 characters using letters, numbers, dots, dashes, "
                    "or underscores."
                ),
            )
        existing_id = session.scalar(select(User.id).where(User.username == candidate))
        if existing_id is not None and existing_id != exclude_user_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="That username is already in use.",
            )
        return candidate

    name_parts = [
        re.sub(r"[^a-z0-9]+", "", part.lower())
        for part in (name or "").strip().split()
    ]
    name_parts = [part for part in name_parts if part]
    base = name_parts[0] if name_parts else re.sub(
        r"[^a-z0-9._-]+", "-", email.split("@", 1)[0].strip().lower()
    ).strip(".-_")
    if len(base) < 2:
        base = f"user-{base}".rstrip("-")
    base = base[:72]
    candidates = [base]
    if len(name_parts) > 1:
        surname_initials = "".join(part[0] for part in name_parts[1:])
        candidates.append(f"{base[: 80 - len(surname_initials)]}{surname_initials}")

    for candidate in candidates:
        existing_id = session.scalar(select(User.id).where(User.username == candidate))
        if existing_id is None or existing_id == exclude_user_id:
            return candidate

    collision_base = candidates[-1]
    suffix = 2
    while True:
        candidate = f"{collision_base[: 79 - len(str(suffix))]}-{suffix}"
        existing_id = session.scalar(select(User.id).where(User.username == candidate))
        if existing_id is None or existing_id == exclude_user_id:
            return candidate
        suffix += 1


def stable_calendar_color(user_id: str) -> str:
    return CALENDAR_COLORS[sum(user_id.encode("utf-8")) % len(CALENDAR_COLORS)]


def ensure_system_roles(session: Session) -> None:
    existing_roles = {
        role.name: role
        for role in session.scalars(
            select(Role).where(Role.name.in_(tuple(ROLE_DEFINITIONS.keys())))
        ).all()
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
        username=user.username,
        name=user.name,
        start_page=user.start_page,
        calendar_color=user.calendar_color or stable_calendar_color(user.id),
        calendar_avatar=user.calendar_avatar,
        worship_max_sundays_per_month=user.worship_max_sundays_per_month,
        sunday_school_max_sundays_per_month=user.sunday_school_max_sundays_per_month,
        email_confirmed=user.email_confirmed,
        active=user.active,
        roles=list_role_names(session, user.id),
        password_set=bool(user.password_hash),
        invite_pending=not bool(user.password_hash),
        registration_pending=user.registration_pending,
        registration_requested_at=user.registration_requested_at,
    )


def get_user_or_404(session: Session, user_id: str) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def set_user_roles(session: Session, user: User, role_names: list[str]) -> None:
    normalized_role_names = canonical_role_names(role_names)
    if not normalized_role_names:
        normalized_role_names = ["viewer"]
    elif (
        any(role_name != "viewer" for role_name in normalized_role_names)
        and "viewer" not in normalized_role_names
    ):
        normalized_role_names.insert(0, "viewer")
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
    values = base.model_dump()
    values["roles"] = list_authorization_role_names(session, user.id)
    return SessionUserRead(**values, permissions=list_permissions(session, user.id))


def user_to_member_read(session: Session, user: User) -> MemberRead:
    approved_preferences = {
        area.key: (
            preference.frequency_count,
            preference.frequency_period,
            preference.rotation_mode,
        )
        for preference, area in session.execute(
            select(VolunteerPreference, ServingArea)
            .join(ServingArea)
            .where(
                VolunteerPreference.user_id == user.id,
                VolunteerPreference.status == "approved",
            )
        ).all()
    }

    def monthly_limit(area_key: str) -> int | None:
        frequency = approved_preferences.get(area_key)
        if frequency is None:
            return None
        count, period, rotation_mode = frequency
        if rotation_mode != "auto":
            return 0
        if period == "week":
            return min(5, count * 5)
        if period == "month":
            return min(5, count)
        return 0

    unavailable = session.scalars(
        select(VolunteerUnavailability)
        .where(VolunteerUnavailability.user_id == user.id)
        .order_by(VolunteerUnavailability.starts_on)
    ).all()
    return MemberRead(
        id=user.id,
        email=user.email,
        username=user.username,
        name=user.name,
        active=user.active,
        roles=list_role_names(session, user.id),
        calendar_color=user.calendar_color or stable_calendar_color(user.id),
        calendar_avatar=user.calendar_avatar,
        worship_max_sundays_per_month=(
            monthly_limit("worship")
            if "worship" in approved_preferences
            else user.worship_max_sundays_per_month
        ),
        sunday_school_max_sundays_per_month=(
            monthly_limit("sunday_school")
            if "sunday_school" in approved_preferences
            else user.sunday_school_max_sundays_per_month
        ),
        approved_serving_areas=list(approved_preferences),
        serving_rotation_modes={key: values[2] for key, values in approved_preferences.items()},
        unavailable=[
            VolunteerUnavailabilityRead(
                id=item.id, starts_on=item.starts_on, ends_on=item.ends_on, note=item.note
            )
            for item in unavailable
        ],
    )


def area_to_read(area: ServingArea) -> ServingAreaRead:
    return ServingAreaRead(
        id=area.id,
        key=area.key,
        name=area.name,
        category=area.category,
        description=area.description,
        legacy_role_name=SERVING_AREA_LEGACY_ROLES.get(area.key),
    )


def preference_to_read(
    session: Session, preference: VolunteerPreference
) -> VolunteerPreferenceRead:
    area = session.get(ServingArea, preference.serving_area_id)
    assert area is not None
    return VolunteerPreferenceRead(
        id=preference.id,
        user_id=preference.user_id,
        area=area_to_read(area),
        status=preference.status,
        initiated_by=preference.initiated_by,
        admin_attention_pending=preference.admin_attention_pending,
        preferred_frequency=preference.preferred_frequency,
        frequency_count=preference.frequency_count,
        frequency_period=preference.frequency_period,
        rotation_mode=preference.rotation_mode,
        availability_notes=preference.availability_notes,
        admin_notes=preference.admin_notes,
        reviewed_at=preference.reviewed_at,
    )


def preference_duplicates_direct_role(
    session: Session, preference: VolunteerPreference, user_id: str
) -> bool:
    area = session.get(ServingArea, preference.serving_area_id)
    equivalent_role = SERVING_AREA_LEGACY_ROLES.get(area.key) if area else None
    return bool(equivalent_role and equivalent_role in list_role_names(session, user_id))


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
    elif purpose == "verify":
        subject = f"Verify your {settings.app_name} email"
        body = (
            f"Hello {user.name},\n\n"
            f"Confirm your email address here:\n{action_url}\n\n"
            "An administrator must also approve your account before you can sign in."
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


def send_smtp_test_email(*, recipient: str, requested_by: User) -> bool:
    subject = f"{settings.app_name} email test"
    body = (
        "Hello,\n\n"
        f"This is a test email from {settings.app_name}.\n\n"
        "If you received this message, SMTP is configured correctly.\n\n"
        f"Requested by: {requested_by.name} <{requested_by.email}>"
    )
    return send_email(to_email=recipient, subject=subject, text_body=body)


def get_valid_auth_token_or_404(session: Session, raw_token: str) -> AuthToken:
    auth_token = session.scalar(
        select(AuthToken).where(AuthToken.token_hash == hash_auth_token(raw_token))
    )
    if auth_token is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found.")
    if auth_token.used_at is not None or auth_token.expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Token has expired.")
    return auth_token


@router.get("/auth/bootstrap-status", response_model=BootstrapStatusRead)
def bootstrap_status(session: Session = Depends(get_session)) -> BootstrapStatusRead:
    return BootstrapStatusRead(available=not has_bootstrap_admin(session))


def self_registration_enabled(session: Session) -> bool:
    block = session.scalar(
        select(SiteContentBlock).where(SiteContentBlock.key == "identity.self_registration")
    )
    return bool(block and block.published and block.value.strip().lower() == "enabled")


def self_registration_url() -> str | None:
    return f"{settings.public_app_url.rstrip('/')}/?signup=1" if settings.public_app_url else None


@router.get("/auth/registration-status", response_model=SelfRegistrationStatusRead)
def registration_status(session: Session = Depends(get_session)) -> SelfRegistrationStatusRead:
    return SelfRegistrationStatusRead(
        enabled=self_registration_enabled(session), registration_url=self_registration_url()
    )


@router.post(
    "/auth/register",
    response_model=SelfRegistrationResultRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def self_register(
    payload: SelfRegistrationRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> SelfRegistrationResultRead:
    enforce_rate_limit(request, "register", attempts=5, minutes=30)
    if not self_registration_enabled(session):
        raise HTTPException(status_code=403, detail="Self-registration is not currently open.")
    try:
        validate_password_strength(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    normalized_email = payload.email.strip().lower()
    if session.scalar(select(User.id).where(func.lower(User.email) == normalized_email)):
        raise HTTPException(status_code=409, detail="An account already exists for that email.")
    try:
        user = User(
            email=normalized_email,
            username=resolve_username(
                session, username=payload.username, email=normalized_email, name=payload.name
            ),
            name=payload.name.strip(),
            start_page="broadcast",
            password_hash=hash_password(payload.password),
            email_confirmed=False,
            active=False,
            registration_pending=True,
            registration_requested_at=datetime.now(UTC),
        )
        session.add(user)
        session.flush()
        user.calendar_color = stable_calendar_color(user.id)
        set_user_roles(session, user, ["viewer"])
        email_sent = False
        if settings.public_app_url:
            _token, raw_token = issue_auth_token(
                session,
                user=user,
                purpose="verify",
                created_by_user_id=None,
                lifetime_hours=24,
            )
            verification_url = build_auth_action_url(purpose="verify", token=raw_token)
            email_sent = smtp_enabled() and send_auth_email(
                user=user, purpose="verify", action_url=verification_url
            )
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=409, detail="That email or username is already in use."
        ) from exc
    return SelfRegistrationResultRead(
        detail=(
            "Registration received. An administrator must approve your account "
            "before you can sign in."
        ),
        email_sent=email_sent,
    )


@router.post("/auth/email-verification/complete", response_model=SelfRegistrationResultRead)
def complete_email_verification(
    payload: EmailVerificationRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> SelfRegistrationResultRead:
    enforce_rate_limit(request, "verify", attempts=10, minutes=30)
    auth_token = get_valid_auth_token_or_404(session, payload.token)
    if auth_token.purpose != "verify":
        raise HTTPException(status_code=409, detail="This is not an email verification link.")
    user = get_user_or_404(session, auth_token.user_id)
    user.email_confirmed = True
    auth_token.used_at = datetime.now(UTC)
    session.commit()
    return SelfRegistrationResultRead(
        detail="Email verified. Your account is waiting for administrator approval."
    )


@router.get("/auth/registration-qr")
def registration_qr(_current_user: User = Depends(require_permission("users:manage"))) -> Response:
    url = self_registration_url()
    if not url:
        raise HTTPException(status_code=503, detail="PUBLIC_APP_URL is not configured.")
    import qrcode
    import qrcode.image.svg

    output = BytesIO()
    qrcode.make(url, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2).save(output)
    return Response(
        content=output.getvalue(),
        media_type="image/svg+xml",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/auth/bootstrap", response_model=SessionUserRead, status_code=status.HTTP_201_CREATED)
def bootstrap_admin(
    payload: BootstrapAdminRequest,
    response: Response,
    session: Session = Depends(get_session),
) -> SessionUserRead:
    if has_bootstrap_admin(session):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Bootstrap is no longer available."
        )

    try:
        validate_password_strength(payload.password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    ensure_system_roles(session)
    session.flush()

    user = session.scalar(select(User).where(User.email == payload.email))
    if user is None:
        user = User(
            email=payload.email,
            username=resolve_username(
                session, username=None, email=payload.email, name=payload.name
            ),
            name=payload.name,
            start_page="presentation",
            email_confirmed=True,
            active=True,
            password_hash=hash_password(payload.password),
        )
        session.add(user)
        session.flush()
        user.calendar_color = stable_calendar_color(user.id)
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
    request: Request = None,
) -> SessionUserRead:
    enforce_rate_limit(request, "login", attempts=12, minutes=15)
    identifier = (payload.identifier or payload.email or "").strip().lower()
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter an email or username.",
        )
    user = session.scalar(
        select(User).where(or_(func.lower(User.email) == identifier, User.username == identifier))
    )
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email/username or password.",
        )
    if user.registration_pending and not user.active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is awaiting administrator approval.",
        )
    if not user.active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email/username or password.",
        )

    set_session_cookie(response, user_id=user.id, remember=payload.remember)
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
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

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
    request: Request = None,
) -> dict[str, str]:
    enforce_rate_limit(request, "password-reset", attempts=5, minutes=30)
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


@router.patch("/auth/me", response_model=SessionUserRead)
def update_session_user(
    payload: SelfProfileUpdate, current_user: CurrentUser, session: Session = Depends(get_session)
) -> SessionUserRead:
    values = payload.model_dump(exclude_unset=True)
    username = values.pop("username", current_user.username)
    try:
        current_user.username = resolve_username(
            session,
            username=username,
            email=values.get("email", current_user.email),
            name=values.get("name", current_user.name),
            exclude_user_id=current_user.id,
        )
        for field, value in values.items():
            setattr(current_user, field, value)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=409, detail="A user with that email or username already exists."
        ) from exc
    session.refresh(current_user)
    return user_to_session_read(session, current_user)


@router.get("/serving/profile", response_model=ServingProfileRead)
def get_serving_profile(
    current_user: CurrentUser, session: Session = Depends(get_session)
) -> ServingProfileRead:
    areas = session.scalars(
        select(ServingArea)
        .where(ServingArea.active.is_(True))
        .order_by(ServingArea.category, ServingArea.name)
    ).all()
    preferences = session.scalars(
        select(VolunteerPreference).where(VolunteerPreference.user_id == current_user.id)
    ).all()
    preferences = [
        preference
        for preference in preferences
        if not preference_duplicates_direct_role(session, preference, current_user.id)
    ]
    unavailable = session.scalars(
        select(VolunteerUnavailability)
        .where(VolunteerUnavailability.user_id == current_user.id)
        .order_by(VolunteerUnavailability.starts_on)
    ).all()
    return ServingProfileRead(
        user=user_to_read(session, current_user),
        areas=[area_to_read(area) for area in areas],
        preferences=[preference_to_read(session, item) for item in preferences],
        unavailable=[
            VolunteerUnavailabilityRead(
                id=item.id, starts_on=item.starts_on, ends_on=item.ends_on, note=item.note
            )
            for item in unavailable
        ],
    )


@router.get("/serving/areas", response_model=list[ServingAreaRead])
def list_serving_areas(
    _current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[ServingAreaRead]:
    areas = session.scalars(
        select(ServingArea)
        .where(ServingArea.active.is_(True))
        .order_by(ServingArea.category, ServingArea.name)
    ).all()
    return [area_to_read(area) for area in areas]


@router.put("/serving/preferences/{area_key}", response_model=VolunteerPreferenceRead)
def volunteer_for_area(
    area_key: str,
    payload: VolunteerPreferenceUpdate,
    current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> VolunteerPreferenceRead:
    area = session.scalar(
        select(ServingArea).where(ServingArea.key == area_key, ServingArea.active.is_(True))
    )
    if area is None:
        raise HTTPException(status_code=404, detail="Serving area not found")
    equivalent_role = SERVING_AREA_LEGACY_ROLES.get(area.key)
    if equivalent_role and equivalent_role in list_role_names(session, current_user.id):
        raise HTTPException(status_code=409, detail="This role is already assigned directly")
    preference = session.scalar(
        select(VolunteerPreference).where(
            VolunteerPreference.user_id == current_user.id,
            VolunteerPreference.serving_area_id == area.id,
        )
    )
    if preference is None:
        preference = VolunteerPreference(
            user_id=current_user.id,
            serving_area_id=area.id,
            status="pending",
            initiated_by="volunteer",
            admin_attention_pending=True,
        )
        session.add(preference)
    preference.preferred_frequency = payload.preferred_frequency
    preference.frequency_count = payload.frequency_count
    preference.frequency_period = payload.frequency_period
    preference.rotation_mode = payload.rotation_mode
    preference.availability_notes = payload.availability_notes
    if preference.status == "declined":
        preference.status = "pending"
        preference.admin_attention_pending = True
        preference.reviewed_at = None
        preference.reviewed_by_user_id = None
    session.commit()
    session.refresh(preference)
    return preference_to_read(session, preference)


@router.patch("/serving/preferences/{area_key}/decision", response_model=VolunteerPreferenceRead)
def decide_serving_invitation(
    area_key: str,
    payload: VolunteerDecisionUpdate,
    current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> VolunteerPreferenceRead:
    preference = session.scalar(
        select(VolunteerPreference)
        .join(ServingArea)
        .where(VolunteerPreference.user_id == current_user.id, ServingArea.key == area_key)
    )
    if preference is None or preference.initiated_by != "admin" or preference.status != "pending":
        raise HTTPException(status_code=409, detail="No pending serving invitation found")
    preference.status = payload.status
    preference.admin_attention_pending = True
    preference.reviewed_at = datetime.now(UTC)
    preference.reviewed_by_user_id = current_user.id
    session.commit()
    session.refresh(preference)
    return preference_to_read(session, preference)


@router.delete("/serving/preferences/{area_key}", status_code=204)
def withdraw_from_area(
    area_key: str, current_user: CurrentUser, session: Session = Depends(get_session)
) -> Response:
    preference = session.scalar(
        select(VolunteerPreference)
        .join(ServingArea)
        .where(VolunteerPreference.user_id == current_user.id, ServingArea.key == area_key)
    )
    if preference is not None:
        session.delete(preference)
        session.commit()
    return Response(status_code=204)


@router.post("/serving/unavailability", response_model=VolunteerUnavailabilityRead, status_code=201)
def add_unavailability(
    payload: VolunteerUnavailabilityCreate,
    current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> VolunteerUnavailabilityRead:
    if payload.ends_on < payload.starts_on:
        raise HTTPException(status_code=422, detail="End date must be on or after start date.")
    item = VolunteerUnavailability(user_id=current_user.id, **payload.model_dump())
    session.add(item)
    session.commit()
    session.refresh(item)
    return VolunteerUnavailabilityRead(
        id=item.id, starts_on=item.starts_on, ends_on=item.ends_on, note=item.note
    )


@router.delete("/serving/unavailability/{item_id}", status_code=204)
def remove_unavailability(
    item_id: str, current_user: CurrentUser, session: Session = Depends(get_session)
) -> Response:
    item = session.scalar(
        select(VolunteerUnavailability).where(
            VolunteerUnavailability.id == item_id,
            VolunteerUnavailability.user_id == current_user.id,
        )
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Availability entry not found")
    session.delete(item)
    session.commit()
    return Response(status_code=204)


@router.get("/serving/admin/volunteers", response_model=list[VolunteerAdminRead])
def list_volunteer_requests(
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> list[VolunteerAdminRead]:
    rows = session.execute(
        select(VolunteerPreference, User)
        .join(User, User.id == VolunteerPreference.user_id)
        .order_by(VolunteerPreference.status.desc(), User.name)
    ).all()
    rows = [
        (preference, user)
        for preference, user in rows
        if not preference_duplicates_direct_role(session, preference, user.id)
    ]
    return [
        VolunteerAdminRead(
            user_id=user.id,
            user_name=user.name,
            user_email=user.email,
            preference=preference_to_read(session, preference),
            unavailable=[
                VolunteerUnavailabilityRead(
                    id=item.id, starts_on=item.starts_on, ends_on=item.ends_on, note=item.note
                )
                for item in session.scalars(
                    select(VolunteerUnavailability).where(
                        VolunteerUnavailability.user_id == user.id
                    )
                ).all()
            ],
        )
        for preference, user in rows
    ]


@router.patch("/serving/admin/volunteers/{preference_id}", response_model=VolunteerPreferenceRead)
def review_volunteer(
    preference_id: str,
    payload: VolunteerReviewUpdate,
    current_user: CurrentUser,
    _permission_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> VolunteerPreferenceRead:
    preference = session.get(VolunteerPreference, preference_id)
    if preference is None:
        raise HTTPException(status_code=404, detail="Volunteer request not found")
    if (
        preference.initiated_by == "admin"
        and preference.status == "pending"
        and payload.status != "pending"
    ):
        raise HTTPException(
            status_code=409, detail="The invited user must accept or reject this invitation"
        )
    preference.status = payload.status
    preference.admin_attention_pending = False
    if payload.preferred_frequency is not None:
        preference.preferred_frequency = payload.preferred_frequency
    if payload.frequency_count is not None:
        preference.frequency_count = payload.frequency_count
    if payload.frequency_period is not None:
        preference.frequency_period = payload.frequency_period
    if payload.rotation_mode is not None:
        preference.rotation_mode = payload.rotation_mode
    if "admin_notes" in payload.model_fields_set:
        preference.admin_notes = payload.admin_notes
    preference.reviewed_at = datetime.now(UTC)
    preference.reviewed_by_user_id = current_user.id
    session.commit()
    session.refresh(preference)
    return preference_to_read(session, preference)


@router.put(
    "/serving/admin/users/{user_id}/preferences/{area_key}", response_model=VolunteerPreferenceRead
)
def invite_volunteer(
    user_id: str,
    area_key: str,
    payload: VolunteerPreferenceUpdate,
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> VolunteerPreferenceRead:
    get_user_or_404(session, user_id)
    area = session.scalar(
        select(ServingArea).where(ServingArea.key == area_key, ServingArea.active.is_(True))
    )
    if area is None:
        raise HTTPException(status_code=404, detail="Serving area not found")
    equivalent_role = SERVING_AREA_LEGACY_ROLES.get(area.key)
    if equivalent_role and equivalent_role in list_role_names(session, user_id):
        raise HTTPException(status_code=409, detail="This role is already assigned directly")
    preference = session.scalar(
        select(VolunteerPreference).where(
            VolunteerPreference.user_id == user_id, VolunteerPreference.serving_area_id == area.id
        )
    )
    if preference is not None:
        raise HTTPException(
            status_code=409, detail="This user already has a serving relationship for that role"
        )
    preference = VolunteerPreference(
        user_id=user_id,
        serving_area_id=area.id,
        status="pending",
        initiated_by="admin",
        admin_attention_pending=False,
    )
    session.add(preference)
    preference.preferred_frequency = payload.preferred_frequency
    preference.frequency_count = payload.frequency_count
    preference.frequency_period = payload.frequency_period
    preference.rotation_mode = payload.rotation_mode
    preference.availability_notes = payload.availability_notes
    preference.status = "pending"
    preference.initiated_by = "admin"
    preference.reviewed_at = None
    preference.reviewed_by_user_id = None
    session.commit()
    session.refresh(preference)
    return preference_to_read(session, preference)


@router.post("/serving/admin/users/{user_id}/attention/read")
def acknowledge_volunteer_attention(
    user_id: str,
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> dict[str, bool]:
    preferences = session.scalars(
        select(VolunteerPreference).where(
            VolunteerPreference.user_id == user_id,
            VolunteerPreference.initiated_by == "admin",
            VolunteerPreference.status != "pending",
            VolunteerPreference.admin_attention_pending.is_(True),
        )
    ).all()
    for preference in preferences:
        preference.admin_attention_pending = False
    session.commit()
    return {"ok": True}


@router.delete("/serving/admin/volunteers/{preference_id}", status_code=204)
def remove_volunteer(
    preference_id: str,
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> Response:
    preference = session.get(VolunteerPreference, preference_id)
    if preference is None:
        raise HTTPException(status_code=404, detail="Volunteer assignment not found")
    session.delete(preference)
    session.commit()
    return Response(status_code=204)


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


@router.post("/email/test", response_model=EmailTestRead)
def send_test_email(
    payload: EmailTestRequest,
    current_user: User = Depends(require_permission("users:manage")),
) -> EmailTestRead:
    if not smtp_enabled():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SMTP is not configured yet. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL.",
        )

    try:
        sent = send_smtp_test_email(recipient=payload.email, requested_by=current_user)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"SMTP test failed: {exc}",
        ) from exc

    return EmailTestRead(sent=sent, recipient=payload.email)


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
    return [user_to_member_read(session, user) for user in users]


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
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc

    try:
        user = User(
            email=payload.email,
            username=resolve_username(
                session, username=payload.username, email=payload.email, name=payload.name
            ),
            name=payload.name,
            start_page=payload.start_page,
            email_confirmed=payload.email_confirmed,
            active=payload.active,
            password_hash=hash_password(payload.password) if payload.password else None,
            calendar_color=payload.calendar_color,
            calendar_avatar=payload.calendar_avatar,
            worship_max_sundays_per_month=payload.worship_max_sundays_per_month,
            sunday_school_max_sundays_per_month=payload.sunday_school_max_sundays_per_month,
        )
        session.add(user)
        session.flush()
        user.calendar_color = user.calendar_color or stable_calendar_color(user.id)
        set_user_roles(session, user, payload.role_names)
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email or username already exists.",
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
            username=resolve_username(
                session, username=payload.username, email=payload.email, name=payload.name
            ),
            name=payload.name,
            start_page=payload.start_page,
            email_confirmed=False,
            active=payload.active,
            password_hash=None,
            calendar_color=payload.calendar_color,
            calendar_avatar=payload.calendar_avatar,
            worship_max_sundays_per_month=payload.worship_max_sundays_per_month,
            sunday_school_max_sundays_per_month=payload.sunday_school_max_sundays_per_month,
        )
        session.add(user)
        session.flush()
        user.calendar_color = user.calendar_color or stable_calendar_color(user.id)
        set_user_roles(session, user, payload.role_names)
        auth_token, raw_token = issue_auth_token(
            session,
            user=user,
            purpose="invite",
            created_by_user_id=current_user.id,
            lifetime_hours=settings.auth_invite_hours,
        )
        action_url = build_auth_action_url(purpose="invite", token=raw_token)
        email_sent = smtp_enabled() and send_auth_email(
            user=user, purpose="invite", action_url=action_url
        )
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email or username already exists.",
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
    username = values.pop("username", None) if "username" in values else user.username

    if password:
        try:
            validate_password_strength(password)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc

    try:
        user.username = resolve_username(
            session,
            username=username,
            email=values.get("email", user.email),
            name=values.get("name", user.name),
            exclude_user_id=user.id,
        )
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
            detail="A user with that email or username already exists.",
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


@router.post("/users/{user_id}/registration/approve", response_model=UserRead)
def approve_registration(
    user_id: str,
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> UserRead:
    user = get_user_or_404(session, user_id)
    if not user.registration_pending:
        raise HTTPException(
            status_code=409, detail="This account is not awaiting registration approval."
        )
    user.registration_pending = False
    user.active = True
    # Admin approval acts as an identity override if SMTP verification was not available.
    user.email_confirmed = True
    set_user_roles(session, user, ["viewer"])
    session.commit()
    session.refresh(user)
    return user_to_read(session, user)


@router.delete("/users/{user_id}/registration", status_code=status.HTTP_204_NO_CONTENT)
def reject_registration(
    user_id: str,
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> Response:
    user = get_user_or_404(session, user_id)
    if not user.registration_pending:
        raise HTTPException(
            status_code=409, detail="This account is not awaiting registration approval."
        )
    session.execute(delete(AuthToken).where(AuthToken.user_id == user.id))
    session.delete(user)
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
    email_sent = smtp_enabled() and send_auth_email(
        user=user, purpose="invite", action_url=action_url
    )
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
    email_sent = smtp_enabled() and send_auth_email(
        user=user, purpose="reset", action_url=action_url
    )
    session.commit()
    return PasswordResetAdminRead(
        reset_url=action_url,
        email_sent=email_sent,
        expires_at=auth_token.expires_at,
    )
