from types import SimpleNamespace

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import app.models  # noqa: F401 -- register the complete model graph for create_all
from app.core.database import Base
from app.modules.broadcast.models import (
    BroadcastViewerSettings,
    LivestreamEvent,
    LivestreamViewerVisit,
)
from app.modules.broadcast.routes import record_viewer_heartbeat
from app.modules.broadcast.schemas import LivestreamHeartbeat
from app.modules.identity.models import User


def test_manual_livestream_heartbeat_creates_one_visit_per_browser_session() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(
            email="viewer@example.com",
            username="viewer",
            name="Online Viewer",
            active=True,
        )
        session.add_all([
            user,
            BroadcastViewerSettings(
                stream_title="Sunday Service",
                manual_live_audience="public",
                pre_service_minutes=60,
                starting_soon_message="Soon",
                offline_message="Offline",
            ),
        ])
        session.commit()

        heartbeat = LivestreamHeartbeat(
            client_session_id="browser-session-1", plan_id=None, viewing=True
        )
        record_viewer_heartbeat(heartbeat, SimpleNamespace(id=user.id), session)
        record_viewer_heartbeat(heartbeat, SimpleNamespace(id=user.id), session)

        assert len(session.scalars(select(LivestreamEvent)).all()) == 1
        visits = session.scalars(select(LivestreamViewerVisit)).all()
        assert len(visits) == 1
        assert visits[0].user_id == user.id
        assert visits[0].ended_at is None

        record_viewer_heartbeat(
            heartbeat.model_copy(update={"viewing": False}),
            SimpleNamespace(id=user.id),
            session,
        )
        assert session.scalar(select(LivestreamViewerVisit)).ended_at is not None
