from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class PresentationSession(IdMixin, TimestampMixin, Base):
    __tablename__ = "presentation_sessions"

    plan_id: Mapped[str] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    presenter_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(60), default="ready")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PresentationPosition(IdMixin, TimestampMixin, Base):
    __tablename__ = "presentation_positions"

    session_id: Mapped[str] = mapped_column(
        ForeignKey("presentation_sessions.id", ondelete="CASCADE"),
        index=True,
    )
    plan_item_id: Mapped[str | None] = mapped_column(ForeignKey("plan_items.id"), index=True)
    slide_index: Mapped[int] = mapped_column(default=0)
    payload_json: Mapped[str | None] = mapped_column(Text)
