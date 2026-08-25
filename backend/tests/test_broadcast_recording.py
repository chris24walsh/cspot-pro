import json
import signal
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base
from app.modules.broadcast.audio_mix import (
    AudioMixInput,
    audio_mix_inputs,
    ffmpeg_live_mix_command,
    ffmpeg_recording_mix_command,
    live_audio_mix_inputs,
)
from app.modules.broadcast.models import BroadcastRecording, BroadcastViewerSettings
from app.modules.broadcast.recording import (
    ActiveRecording,
    _assemble_recording_segments,
    _finalize_recording_file,
    _media_duration,
    _recording_command,
    _should_discard_short_automatic_recording,
    _source_has_audio,
    _source_url,
    _trim_recording_file,
    cancel_pending_recording_stop,
    reconfigure_active_recording,
    request_recording_stop,
    stop_recording,
    sync_sermon_recording,
)
from app.modules.broadcast.routes import (
    live_output_exists,
    settings_read,
    update_manual_livestream,
    update_viewer_settings,
)
from app.modules.broadcast.schemas import (
    BroadcastViewerSettingsUpdate,
    ManualLivestreamUpdate,
)


def test_admin_test_livestream_is_hidden_from_regular_viewers() -> None:
    settings_row = BroadcastViewerSettings(
        stream_title="Service",
        manual_live_audience="admins",
        auto_record_sermons=True,
        recording_grace_seconds=60,
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )

    assert settings_read(settings_row).manual_live_audience == "admins"
    assert (
        settings_read(settings_row, can_view_admin_test=False).manual_live_audience
        == "off"
    )


def test_admin_can_start_public_livestream_without_presentation_output() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__])
    with Session(engine) as session:
        result = update_manual_livestream(
            ManualLivestreamUpdate(audience="public"),
            SimpleNamespace(id="admin-1"),  # type: ignore[arg-type]
            session,
        )

        assert result.manual_live_audience == "public"
        assert session.scalar(
            select(BroadcastViewerSettings.manual_live_audience)
        ) == "public"


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


def test_selected_camera_audio_is_used_for_recording() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__])
    with Session(engine) as session:
        session.add(
            BroadcastViewerSettings(
                stream_title="Service",
                camera_url="http://camera/lectern.m3u8",
                camera_sources_json=json.dumps(
                    [
                        {"id": "lectern", "label": "Lectern", "url": "http://camera/lectern.m3u8"},
                        {"id": "ptz", "label": "Room", "url": "http://camera/ptz.m3u8"},
                    ]
                ),
                live_audio_source="ptz",
                pre_service_minutes=60,
                starting_soon_message="Soon",
                offline_message="Offline",
            )
        )
        session.commit()

        assert _source_url(session) == "http://camera/ptz.m3u8"


def test_multi_camera_settings_are_normalized_and_returned() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__])
    with Session(engine) as session:
        result = update_viewer_settings(
            BroadcastViewerSettingsUpdate(
                camera_sources=[
                    {
                        "id": "lectern",
                        "label": "Lectern",
                        "url": "/app/camera/api/stream.m3u8?src=lectern",
                    },
                    {"id": "ptz", "label": "Room", "url": "/app/camera/api/stream.m3u8?src=ptz"},
                ],
                active_camera_id="ptz",
                camera_cycle_seconds=45,
                camera_fade_ms=1500,
                live_audio_source="lectern",
                mixer_name="Behringer X32",
                mixer_protocol="bridge",
                mixer_control_url="https://mixer-control.church.local",
                mixer_notes="Musicians use monitor buses 1-4.",
                slide_delay_ms=900,
            ),
            SimpleNamespace(id="user-1"),
            session,
        )

        assert [source.id for source in result.camera_sources] == ["lectern", "ptz"]
        assert result.active_camera_id == "ptz"
        assert result.live_audio_source == "lectern"
        assert result.mixer_name == "Behringer X32"
        assert result.mixer_protocol == "bridge"
        assert result.mixer_control_url == "https://mixer-control.church.local"
        assert result.mixer_notes == "Musicians use monitor buses 1-4."
        assert result.camera_cycle_seconds == 45
        assert result.camera_fade_ms == 1500
        assert result.slide_delay_ms == 900


def test_independent_audio_sources_are_grouped_and_selected() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__])
    with Session(engine) as session:
        result = update_viewer_settings(
            BroadcastViewerSettingsUpdate(
                audio_sources=[
                    {"id": "room-mic", "label": "Room mic", "url": "http://audio/room.mp3"},
                    {"id": "desk", "label": "Desk", "url": "http://audio/desk.mp3"},
                ],
                live_audio_source="desk",
            ),
            SimpleNamespace(id="user-1"),
            session,
        )

        assert [source.id for source in result.audio_sources] == ["room-mic", "desk"]
        assert result.live_audio_source == "desk"
        assert result.live_audio_url == "http://audio/desk.mp3"
        assert _source_url(session) == "http://audio/desk.mp3"


def test_enabled_independent_sources_are_combined_with_saved_gain() -> None:
    settings_row = BroadcastViewerSettings(
        stream_title="Service",
        audio_sources_json=json.dumps(
            [
                {
                    "id": "room-mic",
                    "label": "Room mic",
                    "url": "http://audio/room.mp3",
                    "gain_db": -15,
                    "mix_enabled": True,
                },
                {
                    "id": "desk",
                    "label": "Desk",
                    "url": "http://audio/desk.mp3",
                    "gain_db": 4,
                    "mix_enabled": True,
                },
                {
                    "id": "spare",
                    "label": "Spare",
                    "url": "http://audio/spare.mp3",
                    "mix_enabled": False,
                },
            ]
        ),
        live_audio_source="mix",
    )

    inputs = audio_mix_inputs(settings_row)
    command = ffmpeg_live_mix_command(inputs)

    assert [(source.source_id, source.gain_db) for source in inputs] == [
        ("room-mic", -15),
        ("desk", 4),
    ]
    assert command.count("-i") == 2
    filter_graph = command[command.index("-filter_complex") + 1]
    assert "volume@input0=-15dB" in filter_graph
    assert "volume@input1=4dB" in filter_graph
    assert "amix=inputs=2" in filter_graph
    assert "alimiter=limit=0.95" in filter_graph


def test_live_audio_keeps_muted_inputs_connected_for_runtime_control() -> None:
    settings_row = BroadcastViewerSettings(
        stream_title="Service",
        audio_sources_json=json.dumps(
            [
                {"id": "room", "label": "Room", "url": "http://audio/room", "gain_db": -12},
                {"id": "desk", "label": "Desk", "url": "http://audio/desk", "gain_db": 3},
            ]
        ),
        live_audio_source="desk",
    )

    inputs = live_audio_mix_inputs(settings_row)
    command = ffmpeg_live_mix_command(inputs, control_port=23456)
    filter_graph = command[command.index("-filter_complex") + 1]

    assert [(item.source_id, item.gain_db) for item in inputs] == [("room", -120), ("desk", 3)]
    assert "volume@input0=-120dB" in filter_graph
    assert "volume@input1=3dB" in filter_graph
    assert "azmq=b=tcp\\\\://127.0.0.1\\\\:23456" in filter_graph


def test_legacy_independent_audio_url_is_returned_as_a_source() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__])
    with Session(engine) as session:
        session.add(
            BroadcastViewerSettings(
                stream_title="Service",
                live_audio_url="http://audio/legacy.mp3",
                live_audio_source="independent",
                pre_service_minutes=60,
                starting_soon_message="Soon",
                offline_message="Offline",
            )
        )
        session.commit()

        result = update_viewer_settings(
            BroadcastViewerSettingsUpdate(stream_title="Updated service"),
            SimpleNamespace(id="user-1"),
            session,
        )

        assert [(source.id, source.url) for source in result.audio_sources] == [
            ("independent", "http://audio/legacy.mp3")
        ]
        assert result.live_audio_source == "independent"


def test_mixer_control_url_rejects_non_web_links() -> None:
    with pytest.raises(ValueError, match="http or https"):
        BroadcastViewerSettingsUpdate(mixer_control_url="javascript:alert(1)")


def test_recording_source_requires_an_audio_track(monkeypatch) -> None:
    class Probe:
        returncode = 0
        stdout = b"video\n"

    monkeypatch.setattr(
        "app.modules.broadcast.recording.subprocess.run", lambda *args, **kwargs: Probe()
    )

    assert _source_has_audio("http://camera/stream.m3u8") is False


def test_recorder_generates_timestamps_from_audio_samples() -> None:
    command = _recording_command("http://camera/audio", Path("sermon.webm"))

    assert command[command.index("-af") + 1] == "asetpts=N/SR/TB"


def test_mixed_recorder_resets_timestamps_inside_filter_graph() -> None:
    command = ffmpeg_recording_mix_command(
        [
            AudioMixInput("room", "http://audio/room.mp3", -15),
            AudioMixInput("desk", "http://audio/desk.mp3", 0),
        ],
        Path("sermon.webm"),
    )

    assert "asetpts=N/SR/TB" in command[command.index("-filter_complex") + 1]


def test_active_recording_restarts_into_a_new_segment_when_mix_changes(
    monkeypatch, tmp_path: Path
) -> None:
    class Process:
        def __init__(self) -> None:
            self.signals: list[int] = []

        def poll(self) -> None:
            return None

        def send_signal(self, value: int) -> None:
            self.signals.append(value)

        def wait(self, timeout: int) -> int:
            return 0

    old_process = Process()
    new_process = Process()
    file_path = tmp_path / "sermon.webm"
    active = ActiveRecording(
        "recording-1",
        "plan-1",
        old_process,  # type: ignore[arg-type]
        file_path=file_path,
        inputs=[AudioMixInput("room", "http://audio/room.mp3", 0)],
        segment_paths=[tmp_path / "sermon.part-000.webm"],
    )
    monkeypatch.setattr("app.modules.broadcast.recording._active", active)
    monkeypatch.setattr(
        "app.modules.broadcast.recording._audio_inputs",
        lambda _session: [AudioMixInput("desk", "http://audio/desk.mp3", 3)],
    )
    monkeypatch.setattr("app.modules.broadcast.recording._source_has_audio", lambda _url: True)
    monkeypatch.setattr(
        "app.modules.broadcast.recording.subprocess.Popen",
        lambda *args, **kwargs: new_process,
    )

    assert reconfigure_active_recording(SimpleNamespace()) is True  # type: ignore[arg-type]
    assert old_process.signals == [signal.SIGINT]
    assert active.process is new_process
    assert active.inputs == [AudioMixInput("desk", "http://audio/desk.mp3", 3)]
    assert active.segment_paths[-1].name == "sermon.part-001.webm"


def test_single_recording_segment_becomes_final_file(tmp_path: Path) -> None:
    segment = tmp_path / "sermon.part-000.webm"
    final = tmp_path / "sermon.webm"
    segment.write_bytes(b"audio")
    active = ActiveRecording(
        "recording-1",
        "plan-1",
        SimpleNamespace(),  # type: ignore[arg-type]
        file_path=final,
        segment_paths=[segment],
    )

    assert _assemble_recording_segments(active) is True
    assert final.read_bytes() == b"audio"
    assert not segment.exists()


def test_finalization_repairs_a_large_timestamp_gap(tmp_path: Path) -> None:
    recording = tmp_path / "sermon.webm"
    generated = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=48000:duration=101",
            "-af",
            "aselect='lt(t,1)+gt(t,100)'",
            "-c:a",
            "libopus",
            str(recording),
        ],
        check=False,
    )

    assert generated.returncode == 0
    assert (_media_duration(recording) or 0) > 100
    repaired_duration = _finalize_recording_file(recording, 2)
    assert repaired_duration is not None
    assert 1.5 < repaired_duration < 3


def test_grace_audio_can_be_trimmed_back_to_departure(tmp_path: Path) -> None:
    recording = tmp_path / "sermon.webm"
    generated = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=48000:duration=4",
            "-c:a",
            "libopus",
            str(recording),
        ],
        check=False,
    )

    assert generated.returncode == 0
    assert _trim_recording_file(recording, 2)
    duration = _media_duration(recording)
    assert duration is not None
    assert 1.9 < duration < 2.1


def test_short_automatic_recording_is_only_discarded_after_automatic_departure() -> None:
    recording = BroadcastRecording(
        title="Sermon",
        source="automatic-sermon",
        media_kind="audio-slides",
        status="recording",
        file_path="/tmp/sermon.webm",
        file_name="sermon.webm",
    )

    assert _should_discard_short_automatic_recording(
        recording, 29.999, automatic_departure=True
    )
    assert not _should_discard_short_automatic_recording(
        recording, 30, automatic_departure=True
    )
    assert not _should_discard_short_automatic_recording(
        recording, 2, automatic_departure=False
    )
    recording.source = "manual"
    assert not _should_discard_short_automatic_recording(
        recording, 2, automatic_departure=True
    )


def test_short_automatic_recording_and_file_are_deleted_after_grace(
    monkeypatch, tmp_path: Path
) -> None:
    class CompletedProcess:
        def poll(self) -> int:
            return 0

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastRecording.__table__])
    recording_path = tmp_path / "short-sermon.webm"
    recording_path.write_bytes(b"short recording")
    with Session(engine) as session:
        recording = BroadcastRecording(
            title="Sermon",
            source="automatic-sermon",
            media_kind="audio-slides",
            status="recording",
            file_path=str(recording_path),
            file_name=recording_path.name,
            audio_file_path=str(recording_path),
            pending_stop_offset_ms=2_000,
        )
        session.add(recording)
        session.commit()
        recording_id = recording.id
        monkeypatch.setattr(
            "app.modules.broadcast.recording._active",
            ActiveRecording(recording_id, "plan-1", CompletedProcess()),
        )

        result = stop_recording(session, "plan-1", "Left sermon; grace period elapsed")

        assert result is None
        assert session.get(BroadcastRecording, recording_id) is None
        assert not recording_path.exists()


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


def test_live_audio_relay_remains_available_for_explicit_output_session() -> None:
    now = int(datetime.now(UTC).timestamp() * 1000)
    position = SimpleNamespace(
        payload_json=json.dumps(
            {
                "output_owner_id": "output-1",
                "output_heartbeat_at": now - 8000,
                "output_active": True,
            }
        )
    )
    session = SimpleNamespace(scalars=lambda _query: SimpleNamespace(all=lambda: [position]))

    assert live_output_exists(session) is True


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
    monkeypatch.setattr("app.modules.broadcast.recording._active", None)
    monkeypatch.setattr(
        "app.modules.broadcast.recording.start_recording",
        lambda _session, _plan_id, item_id, _user_id: starts.append(item_id),
    )
    monkeypatch.setattr(
        "app.modules.broadcast.recording.record_slide_transition",
        lambda _session, _plan_id, item_id, _offset: transitions.append(item_id),
    )

    sync_sermon_recording(session, "plan-1", None, "sermon-a", 0, "user-1")

    assert starts == ["sermon-a"]
    assert transitions == ["sermon-a"]


def test_active_recording_uses_grace_when_leaving_and_cancels_on_return(monkeypatch) -> None:
    items = {
        "worship": SimpleNamespace(
            id="worship", plan_id="plan-1", item_type="song", title="Worship", deleted_at=None
        ),
        "sermon": SimpleNamespace(
            id="sermon", plan_id="plan-1", item_type="sermon", title="Sermon", deleted_at=None
        ),
    }
    session = SimpleNamespace(get=lambda _model, item_id: items.get(item_id))
    transitions: list[str] = []
    pending: list[str] = []
    cancellations: list[str] = []
    monkeypatch.setattr(
        "app.modules.broadcast.recording._active",
        SimpleNamespace(plan_id="plan-1"),
    )
    monkeypatch.setattr(
        "app.modules.broadcast.recording.record_slide_transition",
        lambda _session, _plan_id, item_id, _offset: transitions.append(item_id),
    )
    monkeypatch.setattr(
        "app.modules.broadcast.recording.request_recording_stop",
        lambda _session, _plan_id, reason: pending.append(reason),
    )
    monkeypatch.setattr(
        "app.modules.broadcast.recording.cancel_pending_recording_stop",
        lambda _session, plan_id: cancellations.append(plan_id),
    )

    sync_sermon_recording(session, "plan-1", "sermon", "worship", 0, "user-1")
    sync_sermon_recording(session, "plan-1", "worship", "sermon", 1, "user-1")

    assert transitions == ["worship", "sermon"]
    assert pending == ["Worship selected"]
    assert cancellations == ["plan-1"]


def test_recording_stop_grace_is_persisted_and_can_be_cancelled(monkeypatch) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[BroadcastViewerSettings.__table__, BroadcastRecording.__table__],
    )
    with Session(engine) as session:
        settings_row = BroadcastViewerSettings(
            stream_title="Service",
            recording_grace_seconds=60,
            pre_service_minutes=60,
            starting_soon_message="Soon",
            offline_message="Offline",
        )
        recording = BroadcastRecording(
            plan_id=None,
            plan_item_id=None,
            title="Sermon",
            source="test",
            media_kind="audio-slides",
            status="recording",
            file_path="/tmp/sermon.webm",
            file_name="sermon.webm",
        )
        session.add_all([settings_row, recording])
        session.commit()
        monkeypatch.setattr(
            "app.modules.broadcast.recording._active",
            SimpleNamespace(plan_id="plan-1", recording_id=recording.id),
        )

        pending = request_recording_stop(session, "plan-1", "End slide reached")
        assert pending is not None
        assert pending.pending_stop_at is not None
        assert pending.pending_stop_reason == "End slide reached"
        assert pending.pending_stop_offset_ms == 0

        resumed = cancel_pending_recording_stop(session, "plan-1")
        assert resumed is not None
        assert resumed.pending_stop_at is None
        assert resumed.pending_stop_reason is None
        assert resumed.pending_stop_offset_ms is None


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
