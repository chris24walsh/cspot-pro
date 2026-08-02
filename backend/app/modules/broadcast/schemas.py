from datetime import datetime

from pydantic import BaseModel, Field


class BroadcastViewerSettingsRead(BaseModel):
    stream_title: str
    stream_description: str | None = None
    camera_url: str | None = None
    live_audio_url: str | None = None
    auto_record_sermons: bool
    pre_service_audio_url: str | None = None
    pre_service_minutes: int
    starting_soon_message: str
    offline_message: str


class BroadcastViewerSettingsUpdate(BaseModel):
    stream_title: str | None = Field(default=None, max_length=180)
    stream_description: str | None = None
    camera_url: str | None = None
    live_audio_url: str | None = None
    auto_record_sermons: bool | None = None
    pre_service_audio_url: str | None = None
    pre_service_minutes: int | None = Field(default=None, ge=0, le=180)
    starting_soon_message: str | None = Field(default=None, max_length=240)
    offline_message: str | None = Field(default=None, max_length=240)


class BroadcastRecordingStart(BaseModel):
    plan_id: str
    plan_item_id: str | None = None


class BroadcastRecordingRead(BaseModel):
    id: str
    plan_id: str | None = None
    plan_item_id: str | None = None
    title: str
    status: str
    media_kind: str
    content_type: str | None = None
    size_bytes: int | None = None
    duration_seconds: int | None = None
    recorded_at: datetime | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    timeline: list[dict[str, object]] = Field(default_factory=list)
