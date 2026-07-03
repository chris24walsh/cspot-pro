from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.recording import _source_url


def test_camera_proxy_path_resolves_to_internal_recording_source() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__])
    previous = settings.camera_proxy_upstream
    settings.camera_proxy_upstream = "http://camera-proxy:1984/"
    try:
        with Session(engine) as session:
            session.add(
                BroadcastViewerSettings(
                    stream_title="Service",
                    camera_url="/app/camera/api/stream.m3u8?src=church",
                    pre_service_minutes=60,
                    starting_soon_message="Soon",
                    offline_message="Offline",
                )
            )
            session.commit()

            assert _source_url(session) == "http://camera-proxy:1984/api/stream.m3u8?src=church"
    finally:
        settings.camera_proxy_upstream = previous
