from pydantic import BaseModel, Field


class BroadcastViewerSettingsRead(BaseModel):
    stream_title: str
    stream_description: str | None = None
    camera_url: str | None = None
    pre_service_audio_url: str | None = None
    pre_service_minutes: int
    starting_soon_message: str
    offline_message: str


class BroadcastViewerSettingsUpdate(BaseModel):
    stream_title: str | None = Field(default=None, max_length=180)
    stream_description: str | None = None
    camera_url: str | None = None
    pre_service_audio_url: str | None = None
    pre_service_minutes: int | None = Field(default=None, ge=0, le=180)
    starting_soon_message: str | None = Field(default=None, max_length=240)
    offline_message: str | None = Field(default=None, max_length=240)
