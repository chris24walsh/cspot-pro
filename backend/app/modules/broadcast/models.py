from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class BroadcastRecording(IdMixin, TimestampMixin, Base):
    __tablename__ = "broadcast_recordings"
    __table_args__ = (UniqueConstraint("file_path", name="uq_broadcast_recordings_file_path"),)

    plan_id: Mapped[str | None] = mapped_column(
        ForeignKey("plans.id", ondelete="SET NULL"), index=True
    )
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
    timeline_json: Mapped[str | None] = mapped_column(Text)
    pending_stop_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pending_stop_reason: Mapped[str | None] = mapped_column(String(240))
    pending_stop_offset_ms: Mapped[int | None] = mapped_column(Integer)
    end_reason: Mapped[str | None] = mapped_column(String(240))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class BroadcastViewerSettings(IdMixin, TimestampMixin, Base):
    __tablename__ = "broadcast_viewer_settings"

    stream_title: Mapped[str] = mapped_column(String(180), default="Sunday Service")
    stream_description: Mapped[str | None] = mapped_column(Text)
    camera_url: Mapped[str | None] = mapped_column(Text)
    camera_sources_json: Mapped[str | None] = mapped_column(Text)
    audio_sources_json: Mapped[str | None] = mapped_column(Text)
    audio_scenes_json: Mapped[str | None] = mapped_column(Text)
    active_audio_scene: Mapped[str] = mapped_column(String(40), default="pastor")
    audio_scene_automation: Mapped[bool] = mapped_column(Boolean, default=True)
    active_camera_id: Mapped[str | None] = mapped_column(String(80))
    camera_cycle_seconds: Mapped[int] = mapped_column(Integer, default=0)
    camera_cycle_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    camera_fade_ms: Mapped[int] = mapped_column(Integer, default=1200)
    live_audio_url: Mapped[str | None] = mapped_column(Text)
    live_audio_source: Mapped[str | None] = mapped_column(String(100))
    manual_live_audience: Mapped[str] = mapped_column(String(20), default="off")
    mixer_name: Mapped[str | None] = mapped_column(String(160))
    mixer_protocol: Mapped[str | None] = mapped_column(String(40))
    mixer_control_url: Mapped[str | None] = mapped_column(Text)
    mixer_notes: Mapped[str | None] = mapped_column(Text)
    slide_delay_ms: Mapped[int] = mapped_column(Integer, default=800)
    auto_record_sermons: Mapped[bool] = mapped_column(Boolean, default=True)
    recording_grace_seconds: Mapped[int] = mapped_column(Integer, default=60)
    pre_service_audio_url: Mapped[str | None] = mapped_column(Text)
    pre_service_minutes: Mapped[int] = mapped_column(Integer, default=60)
    starting_soon_message: Mapped[str] = mapped_column(
        String(240), default="Our service will begin shortly"
    )
    offline_message: Mapped[str] = mapped_column(
        String(240), default="No service is streaming right now"
    )
