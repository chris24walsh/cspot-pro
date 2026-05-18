from pydantic import BaseModel


class ObsStatusRead(BaseModel):
    configured: bool
    connected: bool
    host: str | None = None
    port: int | None = None
    obs_version: str | None = None
    websocket_version: str | None = None
    recording: bool = False
    recording_paused: bool = False
    recording_timecode: str | None = None
    recording_path: str | None = None
    streaming: bool = False
    streaming_timecode: str | None = None
    virtual_camera: bool = False
    error: str | None = None


class ObsActionRead(BaseModel):
    ok: bool
    action: str
    status: ObsStatusRead
    output_path: str | None = None
