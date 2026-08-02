import json
from datetime import UTC, datetime
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.recording import _source_has_audio, _source_url, sync_sermon_recording
from app.modules.broadcast.routes import live_output_exists


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


def test_dedicated_audio_stream_is_preferred_for_recording() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__])
    with Session(engine) as session:
        session.add(
            BroadcastViewerSettings(
                stream_title="Service",
                camera_url="http://camera/stream.m3u8",
                live_audio_url="http://raspberrypi.local:8000/cspot.ogg",
                pre_service_minutes=60,
                starting_soon_message="Soon",
                offline_message="Offline",
            )
        )
        session.commit()

        assert _source_url(session) == "http://raspberrypi.local:8000/cspot.ogg"


def test_recording_source_requires_an_audio_track(monkeypatch) -> None:
    class Probe:
        returncode = 0
        stdout = b"video\n"

    monkeypatch.setattr(
        "app.modules.broadcast.recording.subprocess.run", lambda *args, **kwargs: Probe()
    )

    assert _source_has_audio("http://camera/stream.m3u8") is False


def test_live_audio_relay_requires_a_fresh_output_heartbeat() -> None:
    now = int(datetime.now(UTC).timestamp() * 1000)
    position = SimpleNamespace(
        payload_json=json.dumps(
            {"output_owner_id": "output-1", "output_heartbeat_at": now - 1000}
        )
    )
    session = SimpleNamespace(scalars=lambda _query: SimpleNamespace(all=lambda: [position]))

    assert live_output_exists(session) is True

    position.payload_json = json.dumps(
        {"output_owner_id": "output-1", "output_heartbeat_at": now - 8000}
    )
    assert live_output_exists(session) is False


def test_auto_recording_starts_when_output_opens_on_a_sermon(monkeypatch) -> None:
    items = {
        "welcome": SimpleNamespace(
            id="welcome", plan_id="plan-1", item_type="welcome", deleted_at=None
        ),
        "sermon-a": SimpleNamespace(
            id="sermon-a", plan_id="plan-1", item_type="sermon", deleted_at=None
        ),
        "sermon-b": SimpleNamespace(
            id="sermon-b", plan_id="plan-1", item_type="sermon", deleted_at=None
        ),
    }
    session = SimpleNamespace(
        get=lambda _model, item_id: items.get(item_id),
        scalar=lambda _query: True,
    )
    starts: list[str] = []
    transitions: list[str] = []
    stops: list[str] = []
    monkeypatch.setattr("app.modules.broadcast.recording._active", None)
    monkeypatch.setattr(
        "app.modules.broadcast.recording.start_recording",
        lambda _session, _plan_id, item_id, _user_id: starts.append(item_id),
    )
    monkeypatch.setattr(
        "app.modules.broadcast.recording.record_slide_transition",
        lambda _session, _plan_id, item_id, _offset: transitions.append(item_id),
    )
    monkeypatch.setattr(
        "app.modules.broadcast.recording.stop_recording",
        lambda _session, plan_id: stops.append(plan_id),
    )

    sync_sermon_recording(session, "plan-1", None, "sermon-a", 0, "user-1")
    sync_sermon_recording(session, "plan-1", "sermon-a", "sermon-a", 0, "user-1")
    sync_sermon_recording(session, "plan-1", "sermon-a", "welcome", 0, "user-1")

    assert starts == ["sermon-a"]
    assert transitions == ["sermon-a"]
    assert stops == ["plan-1"]


def test_disabled_auto_recording_does_not_start_on_a_sermon(monkeypatch) -> None:
    sermon = SimpleNamespace(
        id="sermon-a", plan_id="plan-1", item_type="sermon", deleted_at=None
    )
    session = SimpleNamespace(
        get=lambda _model, _item_id: sermon,
        scalar=lambda _query: False,
    )
    starts: list[str] = []
    monkeypatch.setattr("app.modules.broadcast.recording._active", None)
    monkeypatch.setattr("app.modules.broadcast.recording._start_retry_after", {})
    monkeypatch.setattr(
        "app.modules.broadcast.recording.start_recording",
        lambda _session, _plan_id, item_id, _user_id: starts.append(item_id),
    )

    sync_sermon_recording(session, "plan-1", None, "sermon-a", 0, "user-1")

    assert starts == []


def test_failed_auto_recording_start_enters_cooldown(monkeypatch) -> None:
    sermon = SimpleNamespace(
        id="sermon-a", plan_id="plan-1", item_type="sermon", deleted_at=None
    )
    session = SimpleNamespace(
        get=lambda _model, _item_id: sermon,
        scalar=lambda _query: True,
    )
    starts: list[str] = []
    warnings: list[str] = []
    monkeypatch.setattr("app.modules.broadcast.recording._active", None)
    monkeypatch.setattr("app.modules.broadcast.recording._start_retry_after", {})

    def fail_start(_session, _plan_id, item_id, _user_id):
        starts.append(item_id)
        raise RuntimeError("no audio")

    monkeypatch.setattr("app.modules.broadcast.recording.start_recording", fail_start)
    monkeypatch.setattr(
        "app.modules.broadcast.recording.logger.warning",
        lambda _message, error: warnings.append(str(error)),
    )

    sync_sermon_recording(session, "plan-1", None, "sermon-a", 0, "user-1")
    sync_sermon_recording(session, "plan-1", None, "sermon-a", 0, "user-1")

    assert starts == ["sermon-a"]
    assert warnings == ["no audio"]
