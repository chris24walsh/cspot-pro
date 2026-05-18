from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class BroadcastRecording(IdMixin, TimestampMixin, Base):
    __tablename__ = "broadcast_recordings"
    __table_args__ = (UniqueConstraint("file_path", name="uq_broadcast_recordings_file_path"),)

    plan_id: Mapped[str | None] = mapped_column(ForeignKey("plans.id", ondelete="SET NULL"), index=True)
    plan_item_id: Mapped[str | None] = mapped_column(
        ForeignKey("plan_items.id", ondelete="SET NULL"),
        index=True,
    )
    created_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        index=True,
    )
    title: Mapped[str] = mapped_column(String(220))
    source: Mapped[str] = mapped_column(String(80), default="obs")
    media_kind: Mapped[str] = mapped_column(String(40), default="video")
    status: Mapped[str] = mapped_column(String(40), default="ready")
    file_path: Mapped[str] = mapped_column(Text)
    file_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str | None] = mapped_column(String(160))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    audio_file_path: Mapped[str | None] = mapped_column(Text)
    recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
