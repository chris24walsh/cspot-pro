from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class RoleRead(BaseModel):
    id: str
    name: str
    description: str | None = None
    system_role: bool


class UserBase(BaseModel):
    email: str
    name: str
    start_page: str | None = None
    calendar_color: Literal["teacher-a", "teacher-b", "teacher-c", "teacher-d", "teacher-e", "teacher-f"] | None = None
    calendar_avatar: Literal["👤", "🎤", "🎸", "🎹", "🎶", "📖", "🌟", "🌿"] | None = None
    email_confirmed: bool = False
    active: bool = True


class UserCreate(UserBase):
    role_names: list[str] = ["viewer"]
    password: str | None = None


class UserUpdate(BaseModel):
    email: str | None = None
    name: str | None = None
    start_page: str | None = None
    calendar_color: Literal["teacher-a", "teacher-b", "teacher-c", "teacher-d", "teacher-e", "teacher-f"] | None = None
    calendar_avatar: Literal["👤", "🎤", "🎸", "🎹", "🎶", "📖", "🌟", "🌿"] | None = None
    email_confirmed: bool | None = None
    active: bool | None = None
    role_names: list[str] | None = None
    password: str | None = None


class UserRead(UserBase):
    id: str
    roles: list[str]
    password_set: bool
    invite_pending: bool


class MemberRead(BaseModel):
    id: str
    email: str
    name: str
    active: bool
    roles: list[str]
    calendar_color: str | None = None
    calendar_avatar: str | None = None


class SessionUserRead(UserRead):
    permissions: list[str]


class LoginRequest(BaseModel):
    email: str
    password: str
    remember: bool = False


class BootstrapStatusRead(BaseModel):
    available: bool


class BootstrapAdminRequest(BaseModel):
    email: str
    name: str
    password: str


class UserInviteRequest(UserBase):
    role_names: list[str] = ["viewer"]


class UserInviteRead(BaseModel):
    user: UserRead
    invitation_url: str
    email_sent: bool
    expires_at: datetime


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetAdminRead(BaseModel):
    reset_url: str
    email_sent: bool
    expires_at: datetime


class EmailTestRequest(BaseModel):
    email: str


class EmailTestRead(BaseModel):
    sent: bool
    recipient: str


class AuthActionTokenRead(BaseModel):
    purpose: str
    email: str
    name: str
    expires_at: datetime


class AuthActionCompleteRequest(BaseModel):
    token: str
    password: str
