from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class RoleRead(BaseModel):
    id: str
    name: str
    description: str | None = None
    system_role: bool


class UserBase(BaseModel):
    email: str
    username: str | None = None
    name: str
    start_page: str | None = None
    calendar_color: (
        Literal["teacher-a", "teacher-b", "teacher-c", "teacher-d", "teacher-e", "teacher-f"] | None
    ) = None
    calendar_avatar: Literal["👤", "🎤", "🎸", "🎹", "🎶", "📖", "🌟", "🌿"] | None = None
    worship_max_sundays_per_month: int | None = Field(default=None, ge=0, le=5)
    sunday_school_max_sundays_per_month: int | None = Field(default=None, ge=0, le=5)
    email_confirmed: bool = False
    active: bool = True


class UserCreate(UserBase):
    role_names: list[str] = ["viewer"]
    password: str | None = None


class UserUpdate(BaseModel):
    email: str | None = None
    username: str | None = None
    name: str | None = None
    start_page: str | None = None
    calendar_color: (
        Literal["teacher-a", "teacher-b", "teacher-c", "teacher-d", "teacher-e", "teacher-f"] | None
    ) = None
    calendar_avatar: Literal["👤", "🎤", "🎸", "🎹", "🎶", "📖", "🌟", "🌿"] | None = None
    worship_max_sundays_per_month: int | None = Field(default=None, ge=0, le=5)
    sunday_school_max_sundays_per_month: int | None = Field(default=None, ge=0, le=5)
    email_confirmed: bool | None = None
    active: bool | None = None
    role_names: list[str] | None = None
    password: str | None = None


class UserRead(UserBase):
    id: str
    roles: list[str]
    password_set: bool
    invite_pending: bool
    registration_pending: bool = False
    registration_requested_at: datetime | None = None


class SelfRegistrationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: str = Field(min_length=3, max_length=320)
    username: str | None = None
    password: str


class SelfRegistrationStatusRead(BaseModel):
    enabled: bool
    registration_url: str | None = None


class SelfRegistrationResultRead(BaseModel):
    detail: str
    email_sent: bool = False


class EmailVerificationRequest(BaseModel):
    token: str


class VolunteerUnavailabilityCreate(BaseModel):
    starts_on: date
    ends_on: date
    note: str | None = Field(default=None, max_length=300)
    role_keys: list[str] | None = None


class VolunteerUnavailabilityRead(VolunteerUnavailabilityCreate):
    id: str


class MemberRead(BaseModel):
    id: str
    email: str
    username: str
    name: str
    active: bool
    roles: list[str]
    calendar_color: str | None = None
    calendar_avatar: str | None = None
    worship_max_sundays_per_month: int | None = None
    sunday_school_max_sundays_per_month: int | None = None
    approved_serving_areas: list[str] = []
    serving_rotation_modes: dict[str, Literal["auto", "manual", "disabled"]] = {}
    unavailable: list[VolunteerUnavailabilityRead] = []


class SelfProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    email: str | None = Field(default=None, min_length=3, max_length=320)
    username: str | None = None
    calendar_avatar: Literal["👤", "🎤", "🎸", "🎹", "🎶", "📖", "🌟", "🌿"] | None = None


class ServingAreaRead(BaseModel):
    id: str
    key: str
    name: str
    category: str
    description: str | None = None
    legacy_role_name: str | None = None


class VolunteerPreferenceRead(BaseModel):
    id: str
    user_id: str
    area: ServingAreaRead
    status: Literal["pending", "approved", "declined"]
    initiated_by: Literal["volunteer", "admin"] = "volunteer"
    admin_attention_pending: bool = False
    preferred_frequency: Literal["weekly", "monthly", "quarterly", "semi_yearly", "occasional"]
    frequency_count: int = Field(default=1, ge=0, le=52)
    frequency_period: Literal["week", "month", "quarter", "year"] = "month"
    rotation_mode: Literal["auto", "manual", "disabled"] = "auto"
    availability_notes: str | None = None
    admin_notes: str | None = None
    reviewed_at: datetime | None = None


class VolunteerPreferenceUpdate(BaseModel):
    preferred_frequency: Literal["weekly", "monthly", "quarterly", "semi_yearly", "occasional"] = (
        "monthly"
    )
    availability_notes: str | None = Field(default=None, max_length=2000)
    frequency_count: int = Field(default=1, ge=0, le=52)
    frequency_period: Literal["week", "month", "quarter", "year"] = "month"
    rotation_mode: Literal["auto", "manual", "disabled"] = "auto"


class VolunteerReviewUpdate(BaseModel):
    status: Literal["pending", "approved", "declined"]
    preferred_frequency: (
        Literal["weekly", "monthly", "quarterly", "semi_yearly", "occasional"] | None
    ) = None
    admin_notes: str | None = Field(default=None, max_length=2000)
    frequency_count: int | None = Field(default=None, ge=0, le=52)
    frequency_period: Literal["week", "month", "quarter", "year"] | None = None
    rotation_mode: Literal["auto", "manual", "disabled"] | None = None


class VolunteerDecisionUpdate(BaseModel):
    status: Literal["approved", "declined"]


class ServingProfileRead(BaseModel):
    user: UserRead
    areas: list[ServingAreaRead]
    preferences: list[VolunteerPreferenceRead]
    unavailable: list[VolunteerUnavailabilityRead]


class VolunteerAdminRead(BaseModel):
    user_id: str
    user_name: str
    user_email: str
    preference: VolunteerPreferenceRead
    unavailable: list[VolunteerUnavailabilityRead] = []


class SessionUserRead(UserRead):
    permissions: list[str]


class LoginRequest(BaseModel):
    identifier: str | None = None
    email: str | None = None
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
