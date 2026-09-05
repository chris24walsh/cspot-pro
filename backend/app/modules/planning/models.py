from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class PlanType(IdMixin, TimestampMixin, Base):
    __tablename__ = "plan_types"

    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str | None] = mapped_column(String(500))
    starts_at: Mapped[str | None] = mapped_column(String(20))
    automation_start: Mapped[str | None] = mapped_column(String(5))
    default_duration_minutes: Mapped[int | None]
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Plan(IdMixin, TimestampMixin, Base):
    __tablename__ = "plans"

    plan_type_id: Mapped[str] = mapped_column(ForeignKey("plan_types.id"), index=True)
    service_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    title: Mapped[str] = mapped_column(String(180))
    subtitle: Mapped[str | None] = mapped_column(String(180))
    leader_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    teacher_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(40), default="draft")
    info: Mapped[str | None] = mapped_column(Text)
    queued_start: Mapped[str | None] = mapped_column(String(5))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorshipLeaderAssignment(IdMixin, TimestampMixin, Base):
    __tablename__ = "worship_leader_assignments"

    service_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    leader_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)


class PlanItem(IdMixin, TimestampMixin, Base):
    __tablename__ = "plan_items"

    plan_id: Mapped[str] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    parent_item_id: Mapped[str | None] = mapped_column(
        ForeignKey("plan_items.id", ondelete="CASCADE"), index=True
    )
    song_id: Mapped[str | None] = mapped_column(ForeignKey("songs.id"), index=True)
    item_type: Mapped[str] = mapped_column(String(80), default="custom")
    sequence: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    title: Mapped[str] = mapped_column(String(180))
    planned_start: Mapped[str | None] = mapped_column(String(5))
    comment: Mapped[str | None] = mapped_column(Text)
    key_signature: Mapped[str | None] = mapped_column(String(20))
    montage_random: Mapped[bool] = mapped_column(default=False)
    auto_collapse_items: Mapped[bool] = mapped_column(default=False)
    presentation_options: Mapped[dict] = mapped_column(JSON, default=dict)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DefaultItem(IdMixin, TimestampMixin, Base):
    __tablename__ = "default_items"

    plan_type_id: Mapped[str] = mapped_column(ForeignKey("plan_types.id"), index=True)
    parent_item_id: Mapped[str | None] = mapped_column(
        ForeignKey("default_items.id", ondelete="CASCADE"), index=True
    )
    item_type: Mapped[str] = mapped_column(String(80), default="custom")
    sequence: Mapped[Decimal] = mapped_column(Numeric(8, 2))
    title: Mapped[str] = mapped_column(String(180))
    comment: Mapped[str | None] = mapped_column(Text)
    presentation_options: Mapped[dict] = mapped_column(JSON, default=dict)


class PlanNote(IdMixin, TimestampMixin, Base):
    __tablename__ = "plan_notes"

    plan_id: Mapped[str] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ItemNote(IdMixin, TimestampMixin, Base):
    __tablename__ = "item_notes"

    plan_item_id: Mapped[str] = mapped_column(
        ForeignKey("plan_items.id", ondelete="CASCADE"),
        index=True,
    )
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    body: Mapped[str] = mapped_column(Text)


class PlanCache(IdMixin, TimestampMixin, Base):
    __tablename__ = "plan_caches"

    plan_id: Mapped[str] = mapped_column(ForeignKey("plans.id", ondelete="CASCADE"), index=True)
    cache_kind: Mapped[str] = mapped_column(String(80))
    payload_json: Mapped[str] = mapped_column(Text)


class HistoryEntry(IdMixin, TimestampMixin, Base):
    __tablename__ = "history_entries"

    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    entity_type: Mapped[str] = mapped_column(String(80), index=True)
    entity_id: Mapped[str] = mapped_column(String(36), index=True)
    action: Mapped[str] = mapped_column(String(80))
    details: Mapped[str | None] = mapped_column(Text)
