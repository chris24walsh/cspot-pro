from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


class BroadcastCameraSource(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=2000)


class BroadcastAudioSource(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=2000)
    gain_db: float = Field(default=0, ge=-30, le=24)
    mix_enabled: bool = True


class BroadcastAudioSourceRead(BaseModel):
    id: str
    label: str
    url: str | None = None
    stream_name: str | None = None
    gain_db: float = 0
    mix_enabled: bool = True


class BroadcastAudioSceneChannel(BaseModel):
    gain_db: float = Field(default=0, ge=-30, le=24)
    enabled: bool = True


class BroadcastAudioScene(BaseModel):
    id: Literal["pastor", "congregation", "worship", "media"]
    label: str = Field(min_length=1, max_length=80)
    channels: dict[str, BroadcastAudioSceneChannel] = Field(default_factory=dict)


class BroadcastViewerSettingsRead(BaseModel):
    stream_title: str
    stream_description: str | None = None
    camera_url: str | None = None
    camera_sources: list[BroadcastCameraSource] = Field(default_factory=list)
    audio_sources: list[BroadcastAudioSourceRead] = Field(default_factory=list)
    audio_scenes: list[BroadcastAudioScene] = Field(default_factory=list)
    active_audio_scene: str = "pastor"
    audio_scene_automation: bool = True
    active_camera_id: str | None = None
    camera_cycle_seconds: int
    camera_cycle_started_at: datetime | None = None
    camera_fade_ms: int
    live_audio_url: str | None = None
    live_audio_source: str
    live_audio_stream_name: str | None = None
    manual_live_audience: Literal["off", "public", "admins"] = "off"
    mixer_name: str | None = None
    mixer_protocol: str
    mixer_control_url: str | None = None
    mixer_notes: str | None = None
    slide_delay_ms: int
    auto_record_sermons: bool
    recording_grace_seconds: int
    pre_service_audio_url: str | None = None
    pre_service_minutes: int
    starting_soon_message: str
    offline_message: str


class BroadcastViewerSettingsUpdate(BaseModel):
    stream_title: str | None = Field(default=None, max_length=180)
    stream_description: str | None = None
    camera_url: str | None = None
    camera_sources: list[BroadcastCameraSource] | None = Field(default=None, max_length=8)
    audio_sources: list[BroadcastAudioSource] | None = Field(default=None, max_length=8)
    audio_scenes: list[BroadcastAudioScene] | None = Field(default=None, max_length=4)
    active_audio_scene: str | None = Field(default=None, max_length=40)
    audio_scene_automation: bool | None = None
    active_camera_id: str | None = Field(default=None, max_length=80)
    camera_cycle_seconds: int | None = Field(default=None, ge=0, le=3600)
    camera_fade_ms: int | None = Field(default=None, ge=0, le=10000)
    live_audio_url: str | None = None
    live_audio_source: str | None = Field(default=None, max_length=100)
    mixer_name: str | None = Field(default=None, max_length=160)
    mixer_protocol: str | None = Field(default=None, max_length=40)
    mixer_control_url: str | None = Field(default=None, max_length=2000)
    mixer_notes: str | None = Field(default=None, max_length=2000)
    slide_delay_ms: int | None = Field(default=None, ge=0, le=10000)
    auto_record_sermons: bool | None = None
    recording_grace_seconds: int | None = Field(default=None, ge=0, le=600)
    pre_service_audio_url: str | None = None
    pre_service_minutes: int | None = Field(default=None, ge=0, le=180)
    starting_soon_message: str | None = Field(default=None, max_length=240)
    offline_message: str | None = Field(default=None, max_length=240)

    @field_validator("mixer_control_url")
    @classmethod
    def validate_mixer_control_url(cls, value: str | None) -> str | None:
        if value and urlsplit(value).scheme.lower() not in {"http", "https"}:
            raise ValueError("Mixer control URL must use http or https")
        return value


class ManualLivestreamUpdate(BaseModel):
    audience: Literal["off", "public", "admins"]


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
    pending_stop_at: datetime | None = None
    pending_stop_reason: str | None = None
    end_reason: str | None = None
    timeline: list[dict[str, object]] = Field(default_factory=list)
