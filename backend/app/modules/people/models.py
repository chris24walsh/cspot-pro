from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class Instrument(IdMixin, TimestampMixin, Base):
    __tablename__ = "instruments"

    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    sort_order: Mapped[int] = mapped_column(default=0)


class UserInstrument(IdMixin, TimestampMixin, Base):
    __tablename__ = "user_instruments"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    instrument_id: Mapped[str] = mapped_column(
        ForeignKey("instruments.id", ondelete="CASCADE"),
        index=True,
    )


class TeamAssignment(IdMixin, TimestampMixin, Base):
    __tablename__ = "team_assignments"

    plan_id: Mapped[str] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    role_label: Mapped[str] = mapped_column(String(120))
    instrument_id: Mapped[str | None] = mapped_column(ForeignKey("instruments.id"), index=True)
    status: Mapped[str] = mapped_column(String(60), default="invited")
    confirmation_token: Mapped[str | None] = mapped_column(String(120), index=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
