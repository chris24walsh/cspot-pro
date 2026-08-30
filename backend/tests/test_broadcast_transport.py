import asyncio
import json
from contextlib import nullcontext
from types import SimpleNamespace

import pytest
import requests
from fastapi import HTTPException, status
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import main
from app.core.database import Base
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.routes import (
    playback_authorized,
    settings_read,
    update_viewer_settings,
)
from app.modules.broadcast.schemas import BroadcastAudioSource, BroadcastViewerSettingsUpdate
from app.modules.broadcast.transport import (
    GO2RTC_AUDIO_STREAM_PREFIX,
    audio_stream_name,
    camera_stream_name,
    reconcile_audio_sources,
)


class FakeResponse:
    def __init__(self, payload: object | None = None, *, error: Exception | None = None):
        self.payload = payload
        self.error = error

    def raise_for_status(self) -> None:
        if self.error is not None:
            raise self.error

    def json(self) -> object:
        return self.payload


def audio_source(source_id: str = "desk", url: str = "http://audio/desk.mp3?token=secret"):
    return BroadcastAudioSource(id=source_id, label="Desk", url=url)


def test_audio_stream_names_are_stable_opaque_and_http_only() -> None:
    source = audio_source()
    stream_name = audio_stream_name(source)

    assert stream_name == audio_stream_name(source)
    assert stream_name is not None
    assert stream_name.startswith(GO2RTC_AUDIO_STREAM_PREFIX)
    assert "desk" not in stream_name
    assert "secret" not in stream_name
    assert audio_stream_name(audio_source(url="rtsp://audio/desk")) is None


def test_camera_stream_name_accepts_only_named_proxied_sources() -> None:
    source = SimpleNamespace(
        url="https://cspot.example/app/camera/api/stream.m3u8?video=h264&src=lectern"
    )
    assert camera_stream_name(source) == "lectern"

    source.url = "/app/camera/api/stream.m3u8?src=ffmpeg:http%3A%2F%2Fprivate"
    assert camera_stream_name(source) is None
    source.url = "https://camera.example/stream.m3u8?src=lectern"
    assert camera_stream_name(source) is None


def test_settings_read_exposes_only_selected_independent_stream_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.modules.broadcast.transport.settings.camera_proxy_upstream",
        "http://go2rtc:1984/",
    )
    settings = BroadcastViewerSettings(
        stream_title="Service",
        auto_record_sermons=True,
        audio_sources_json=json.dumps(
            [
                {"id": "room", "label": "Room", "url": "http://audio/room.mp3"},
                {"id": "desk", "label": "Desk", "url": "http://audio/desk.mp3?token=secret"},
            ]
        ),
        live_audio_source="desk",
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )

    result = settings_read(settings)

    assert result.live_audio_stream_name == audio_stream_name(audio_source())
    assert result.live_audio_stream_name is not None
    assert "secret" not in result.live_audio_stream_name
    assert result.audio_sources[1].stream_name == result.live_audio_stream_name


def test_settings_read_uses_raw_fallback_without_configured_gateway(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.modules.broadcast.transport.settings.camera_proxy_upstream",
        None,
    )
    settings = BroadcastViewerSettings(
        stream_title="Service",
        auto_record_sermons=True,
        audio_sources_json=json.dumps([audio_source().model_dump()]),
        live_audio_source="desk",
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )

    assert settings_read(settings).live_audio_stream_name is None


def test_settings_read_uses_normalized_stream_for_unity_gain_single_source_mix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.modules.broadcast.transport.settings.camera_proxy_upstream",
        "http://go2rtc:1984/",
    )
    media = BroadcastAudioSource(
        id="pc-media",
        label="Church PC media",
        url="http://audio/pc-media.mp3?token=secret",
        gain_db=0,
        mix_enabled=True,
        role="media",
    )
    settings = BroadcastViewerSettings(
        stream_title="Service",
        auto_record_sermons=True,
        audio_sources_json=json.dumps([media.model_dump()]),
        live_audio_source="mix",
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )

    result = settings_read(settings, include_audio_source_urls=False)

    assert result.live_audio_stream_name == audio_stream_name(media)
    assert result.live_audio_stream_name is not None
    assert "secret" not in result.live_audio_stream_name
    assert result.audio_sources[0].url is None
    assert result.audio_sources[0].stream_name is None


@pytest.mark.parametrize(
    "sources",
    [
        [
            BroadcastAudioSource(
                id="room",
                label="Room",
                url="http://audio/room.mp3",
                mix_enabled=True,
            ),
            BroadcastAudioSource(
                id="desk",
                label="Desk",
                url="http://audio/desk.mp3",
                mix_enabled=True,
            ),
        ],
        [
            BroadcastAudioSource(
                id="desk",
                label="Desk",
                url="http://audio/desk.mp3",
                gain_db=-3,
                mix_enabled=True,
            )
        ],
    ],
)
def test_settings_read_keeps_real_mix_on_server_relay(
    monkeypatch: pytest.MonkeyPatch,
    sources: list[BroadcastAudioSource],
) -> None:
    monkeypatch.setattr(
        "app.modules.broadcast.transport.settings.camera_proxy_upstream",
        "http://go2rtc:1984/",
    )
    settings = BroadcastViewerSettings(
        stream_title="Service",
        auto_record_sermons=True,
        audio_sources_json=json.dumps([source.model_dump() for source in sources]),
        live_audio_source="mix",
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )

    assert settings_read(settings).live_audio_stream_name is None


def test_settings_read_redacts_independent_source_urls_for_viewers() -> None:
    settings = BroadcastViewerSettings(
        stream_title="Service",
        auto_record_sermons=True,
        audio_sources_json=json.dumps([audio_source().model_dump()]),
        live_audio_url="http://audio/desk.mp3?token=secret",
        live_audio_source="desk",
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )

    result = settings_read(settings, include_audio_source_urls=False)

    assert result.live_audio_url is None
    assert result.audio_sources[0].url is None
    assert result.audio_sources[0].stream_name is None
    assert result.audio_sources[0].label == "Desk"


def test_reconcile_registers_missing_sources_before_removing_stale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = audio_source()
    desired_name = audio_stream_name(source)
    stale_name = f"{GO2RTC_AUDIO_STREAM_PREFIX}stale"
    calls: list[tuple[str, dict[str, str] | None]] = []
    monkeypatch.setattr(
        "app.modules.broadcast.transport.settings.camera_proxy_upstream",
        "http://go2rtc:1984/",
    )
    monkeypatch.setattr(
        "app.modules.broadcast.transport.requests.get",
        lambda *_args, **_kwargs: FakeResponse({stale_name: {}, "camera": {}}),
    )

    def put(_url: str, *, params: dict[str, str], **_kwargs: object) -> FakeResponse:
        calls.append(("put", params))
        return FakeResponse()

    def delete(_url: str, *, params: dict[str, str], **_kwargs: object) -> FakeResponse:
        calls.append(("delete", params))
        return FakeResponse()

    monkeypatch.setattr("app.modules.broadcast.transport.requests.put", put)
    monkeypatch.setattr("app.modules.broadcast.transport.requests.delete", delete)

    reconcile_audio_sources([source])

    assert calls == [
        (
            "put",
            {
                "name": desired_name,
                "src": "ffmpeg:http://audio/desk.mp3?token=secret#audio=aac",
            },
        ),
        ("delete", {"src": stale_name}),
    ]


def test_reconcile_preserves_stale_source_when_registration_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stale_name = f"{GO2RTC_AUDIO_STREAM_PREFIX}stale"
    deleted: list[str] = []
    monkeypatch.setattr(
        "app.modules.broadcast.transport.settings.camera_proxy_upstream",
        "http://go2rtc:1984/",
    )
    monkeypatch.setattr(
        "app.modules.broadcast.transport.requests.get",
        lambda *_args, **_kwargs: FakeResponse({stale_name: {}}),
    )
    monkeypatch.setattr(
        "app.modules.broadcast.transport.requests.put",
        lambda *_args, **_kwargs: FakeResponse(
            error=requests.HTTPError("response URL intentionally omitted")
        ),
    )
    monkeypatch.setattr(
        "app.modules.broadcast.transport.requests.delete",
        lambda _url, *, params, **_kwargs: deleted.append(params["src"]),
    )

    reconcile_audio_sources([audio_source()])

    assert deleted == []


def test_viewer_settings_update_reconciles_saved_audio_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__])
    reconciled: list[list[BroadcastAudioSource]] = []
    monkeypatch.setattr(
        "app.modules.broadcast.routes.reconcile_audio_sources",
        lambda sources: reconciled.append(list(sources)),
    )

    with Session(engine) as session:
        update_viewer_settings(
            BroadcastViewerSettingsUpdate(
                audio_sources=[audio_source().model_dump()],
                live_audio_source="desk",
            ),
            SimpleNamespace(id="admin"),
            session,
        )

    assert [[source.id for source in sources] for sources in reconciled] == [["desk"]]


def test_application_startup_reconciles_stored_audio_sources(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    viewer = BroadcastViewerSettings(
        stream_title="Service",
        audio_sources_json=json.dumps([audio_source().model_dump()]),
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )
    fake_session = SimpleNamespace(scalar=lambda _query: viewer)

    class FakeSessionLocal:
        def begin(self):
            return nullcontext(fake_session)

    reconciled: list[list[BroadcastAudioSource]] = []
    monkeypatch.setattr(main, "SessionLocal", FakeSessionLocal())
    monkeypatch.setattr(main, "ensure_worship_set_plan_type", lambda _session: None)
    monkeypatch.setattr(
        main,
        "reconcile_audio_sources",
        lambda sources: reconciled.append(list(sources)),
    )

    async def run_lifespan() -> None:
        async with main.lifespan(None):  # type: ignore[arg-type]
            pass

    asyncio.run(run_lifespan())

    assert [[source.id for source in sources] for sources in reconciled] == [["desk"]]


@pytest.mark.parametrize(
    ("permissions", "manual_audience", "live_output", "allowed"),
    [
        (["broadcast:use"], "off", False, True),
        (["users:manage"], "off", False, True),
        (["plans:read"], "public", False, True),
        (["plans:read"], "off", True, True),
        (["plans:read"], "admins", False, False),
        (["plans:read"], "off", False, False),
    ],
)
def test_playback_authorization(
    monkeypatch: pytest.MonkeyPatch,
    permissions: list[str],
    manual_audience: str,
    live_output: bool,
    allowed: bool,
) -> None:
    viewer = BroadcastViewerSettings(
        stream_title="Service",
        manual_live_audience=manual_audience,
        camera_sources_json=json.dumps(
            [
                {
                    "id": "lectern",
                    "label": "Lectern",
                    "url": "/app/camera/api/stream.m3u8?src=lectern",
                }
            ]
        ),
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )
    session = SimpleNamespace(
        scalar=lambda _query: viewer,
        add=lambda _value: None,
        commit=lambda: None,
        refresh=lambda _value: None,
    )
    monkeypatch.setattr("app.modules.broadcast.routes.list_permissions", lambda *_args: permissions)
    monkeypatch.setattr(
        "app.modules.broadcast.routes.live_output_exists", lambda _session: live_output
    )

    if allowed:
        response = playback_authorized(
            SimpleNamespace(id="viewer"),
            session,
            "lectern",
        )
        assert response.status_code == status.HTTP_204_NO_CONTENT
    else:
        with pytest.raises(HTTPException) as caught:
            playback_authorized(
                SimpleNamespace(id="viewer"),
                session,
                "lectern",
            )
        assert caught.value.status_code == status.HTTP_403_FORBIDDEN


def test_playback_authorization_rejects_unconfigured_dynamic_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    viewer = BroadcastViewerSettings(
        stream_title="Service",
        camera_sources_json=json.dumps(
            [
                {
                    "id": "lectern",
                    "label": "Lectern",
                    "url": "/app/camera/api/stream.m3u8?src=lectern",
                }
            ]
        ),
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )
    session = SimpleNamespace(scalar=lambda _query: viewer)
    monkeypatch.setattr(
        "app.modules.broadcast.routes.list_permissions",
        lambda *_args: ["broadcast:use"],
    )

    with pytest.raises(HTTPException) as caught:
        playback_authorized(
            SimpleNamespace(id="admin"),
            session,
            "ffmpeg:http://private/service",
        )

    assert caught.value.status_code == status.HTTP_403_FORBIDDEN


def test_playback_authorization_allows_enabled_source_in_selected_mix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = audio_source()
    viewer = BroadcastViewerSettings(
        stream_title="Service",
        manual_live_audience="public",
        live_audio_source="mix",
        audio_sources_json=json.dumps([source.model_dump()]),
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )
    session = SimpleNamespace(scalar=lambda _query: viewer)
    monkeypatch.setattr(
        "app.modules.broadcast.routes.list_permissions",
        lambda *_args: ["plans:read"],
    )

    response = playback_authorized(
        SimpleNamespace(id="viewer"),
        session,
        audio_stream_name(source),
    )

    assert response.status_code == status.HTTP_204_NO_CONTENT


def test_playback_authorization_allows_hls_session_for_visible_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    viewer = BroadcastViewerSettings(
        stream_title="Service",
        manual_live_audience="public",
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )
    session = SimpleNamespace(scalar=lambda _query: viewer)
    monkeypatch.setattr(
        "app.modules.broadcast.routes.list_permissions",
        lambda *_args: ["plans:read"],
    )

    response = playback_authorized(
        SimpleNamespace(id="viewer"),
        session,
        None,
        "/app/camera/api/hls/segment.m4s?id=session",
    )

    assert response.status_code == status.HTTP_204_NO_CONTENT
