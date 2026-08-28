from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    start_page: Mapped[str | None] = mapped_column(String(255))
    calendar_color: Mapped[str | None] = mapped_column(String(24))
    calendar_avatar: Mapped[str | None] = mapped_column(String(16))
    worship_max_sundays_per_month: Mapped[int | None] = mapped_column(Integer)
    sunday_school_max_sundays_per_month: Mapped[int | None] = mapped_column(Integer)
    email_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    registration_pending: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    registration_requested_at: Mapped[datetime | None]


class Role(IdMixin, TimestampMixin, Base):
    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(String(500))
    system_role: Mapped[bool] = mapped_column(Boolean, default=False)


class UserRole(IdMixin, TimestampMixin, Base):
    __tablename__ = "user_roles"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), index=True)


class SocialLogin(IdMixin, TimestampMixin, Base):
    __tablename__ = "social_logins"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(80), index=True)
    provider_user_id: Mapped[str] = mapped_column(String(255), index=True)


class AuthToken(IdMixin, TimestampMixin, Base):
    __tablename__ = "auth_tokens"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    purpose: Mapped[str] = mapped_column(String(40), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    sent_to_email: Mapped[str] = mapped_column(String(320), index=True)
    expires_at: Mapped[datetime] = mapped_column(index=True)
    used_at: Mapped[datetime | None]


class ServingArea(IdMixin, TimestampMixin, Base):
    __tablename__ = "serving_areas"

    key: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(80), index=True)
    description: Mapped[str | None] = mapped_column(String(500))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class VolunteerPreference(IdMixin, TimestampMixin, Base):
    __tablename__ = "volunteer_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "serving_area_id", name="uq_volunteer_user_area"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    serving_area_id: Mapped[str] = mapped_column(
        ForeignKey("serving_areas.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    initiated_by: Mapped[str] = mapped_column(String(24), default="volunteer")
    admin_attention_pending: Mapped[bool] = mapped_column(Boolean, default=True)
    preferred_frequency: Mapped[str] = mapped_column(String(24), default="monthly")
    frequency_count: Mapped[int] = mapped_column(Integer, default=1)
    frequency_period: Mapped[str] = mapped_column(String(16), default="month")
    rotation_mode: Mapped[str] = mapped_column(String(16), default="auto", index=True)
    availability_notes: Mapped[str | None] = mapped_column(Text)
    admin_notes: Mapped[str | None] = mapped_column(Text)
    reviewed_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    reviewed_at: Mapped[datetime | None]


class VolunteerUnavailability(IdMixin, TimestampMixin, Base):
    __tablename__ = "volunteer_unavailability"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    starts_on: Mapped[date] = mapped_column(Date, index=True)
    ends_on: Mapped[date] = mapped_column(Date, index=True)
    note: Mapped[str | None] = mapped_column(String(300))
    role_keys: Mapped[list[str] | None] = mapped_column(JSON)
