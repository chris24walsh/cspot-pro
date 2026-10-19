"""Delegation policies shared by account management entry points."""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.identity.auth import list_role_names
from app.modules.identity.models import ServingAreaManager, User
from app.modules.identity.permissions import MANAGEMENT_ROLES, ROLE_DEFINITIONS, normalize_role_name


def is_full_administrator(session: Session, actor: User) -> bool:
    return "administrator" in list_role_names(session, actor.id)


def is_protected_account(session: Session, user_id: str) -> bool:
    return bool(MANAGEMENT_ROLES.intersection(list_role_names(session, user_id))) or bool(
        session.scalar(select(ServingAreaManager.id).where(ServingAreaManager.user_id == user_id))
    )


def require_account_management(session: Session, actor: User, target: User) -> None:
    if not is_full_administrator(session, actor) and is_protected_account(session, target.id):
        raise HTTPException(
            status_code=403, detail="Only a full administrator can manage this account"
        )


def validate_role_grant(session: Session, actor: User, role_names: list[str]) -> None:
    names = {normalize_role_name(name) for name in role_names}
    unknown = names - ROLE_DEFINITIONS.keys()
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown roles: {', '.join(sorted(unknown))}")
    if not is_full_administrator(session, actor) and names.intersection(MANAGEMENT_ROLES):
        raise HTTPException(
            status_code=403, detail="Only a full administrator can delegate management access"
        )
