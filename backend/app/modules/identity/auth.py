from __future__ import annotations

from collections.abc import Callable
from typing import Annotated

import jwt
from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_session
from app.modules.identity.models import Role, User, UserRole
from app.modules.identity.permissions import canonical_role_names, permissions_for_roles
from app.modules.identity.security import build_session_token, decode_session_token

SESSION_COOKIE_NAME = "cspot_pro_session"


def list_role_names(session: Session, user_id: str) -> list[str]:
    raw_names = list(
        session.scalars(
            select(Role.name)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user_id)
            .order_by(Role.name)
        )
    )
    return canonical_role_names(raw_names)


def list_permissions(session: Session, user_id: str) -> list[str]:
    return sorted(permissions_for_roles(list_role_names(session, user_id)))


def has_bootstrap_admin(session: Session) -> bool:
    return bool(
        session.scalar(
            select(func.count(User.id))
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                Role.name == "administrator",
                User.active.is_(True),
                User.password_hash.is_not(None),
            )
        )
    )


def set_session_cookie(response: Response, *, user_id: str, remember: bool = False) -> None:
    max_age = (
        settings.remembered_session_days * 24 * 60 * 60
        if remember
        else settings.session_hours * 60 * 60
    )
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=build_session_token(user_id=user_id, lifetime_hours=max_age // 3600),
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=max_age,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


def _auth_error(detail: str = "Authentication required") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def get_current_user(
    session: Session = Depends(get_session),
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> User:
    if not session_token:
        raise _auth_error()

    try:
        payload = decode_session_token(session_token)
    except jwt.InvalidTokenError as exc:
        raise _auth_error("Invalid session") from exc

    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise _auth_error("Invalid session")

    user = session.get(User, user_id)
    if user is None or not user.active:
        raise _auth_error("User is not active")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_permission(permission_name: str) -> Callable[[User, Session], User]:
    def dependency(
        current_user: CurrentUser,
        session: Session = Depends(get_session),
    ) -> User:
        permissions = permissions_for_roles(list_role_names(session, current_user.id))
        if permission_name not in permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission required: {permission_name}",
            )
        return current_user

    return dependency


def require_any_permission(*permission_names: str) -> Callable[[User, Session], User]:
    def dependency(
        current_user: CurrentUser,
        session: Session = Depends(get_session),
    ) -> User:
        permissions = permissions_for_roles(list_role_names(session, current_user.id))
        if permissions.intersection(permission_names):
            return current_user
        needed = " or ".join(permission_names)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission required: {needed}",
        )

    return dependency
