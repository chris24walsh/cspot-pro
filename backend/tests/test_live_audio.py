import asyncio
import shutil
import subprocess
import threading
import time
from types import SimpleNamespace

import pytest

from app.modules.broadcast.audio_mix import AudioMixInput
from app.modules.broadcast.live_audio import (
    LiveAudioControl,
    allocate_control_port,
    register_live_audio_control,
    unregister_live_audio_control,
    update_live_audio_controls,
)
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.routes import _live_audio_fmp4_chunks, live_audio_fmp4


class FakeStdout:
    def __init__(self, chunks: list[bytes]):
        self.chunks = chunks
        self.closed = False

    def read(self, _size: int) -> bytes:
        return self.chunks.pop(0) if self.chunks else b""

    def close(self) -> None:
        self.closed = True


class FakeProcess:
    def __init__(self, chunks: list[bytes]):
        self.stdout = FakeStdout(chunks)
        self.terminated = False
        self.killed = False
        self.waits: list[int] = []
        self.wait_thread_ids: list[int] = []

    def poll(self) -> int | None:
        return 0 if self.terminated or self.killed else None

    def terminate(self) -> None:
        self.terminated = True

    def kill(self) -> None:
        self.killed = True

    def wait(self, timeout: int) -> int:
        self.waits.append(timeout)
        self.wait_thread_ids.append(threading.get_ident())
        return 0


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_running_ffmpeg_volume_can_be_updated_without_restart() -> None:
    port = allocate_control_port()
    initial = [AudioMixInput(source_id="desk", url="test://desk", gain_db=0)]
    process = subprocess.Popen(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-re",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:sample_rate=48000",
            "-filter_complex",
            f"[0:a]volume@input0=0dB,azmq=b=tcp\\\\://127.0.0.1\\\\:{port}[audio]",
            "-map",
            "[audio]",
            "-f",
            "null",
            "-",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    control = register_live_audio_control(port, initial)
    try:
        time.sleep(0.5)
        assert (
            update_live_audio_controls(
                [AudioMixInput(source_id="desk", url="test://desk", gain_db=-12)]
            )
            == 1
        )
        assert process.poll() is None
    finally:
        unregister_live_audio_control(control)
        process.terminate()
        process.wait(timeout=5)


def test_fmp4_stream_cancellation_reaps_ffmpeg_immediately() -> None:
    process = FakeProcess([b"init", b"media"])
    event_loop_thread = threading.get_ident()

    async def cancel_after_first_chunk() -> None:
        chunks = _live_audio_fmp4_chunks(
            process,  # type: ignore[arg-type]
            LiveAudioControl(port=12345, inputs=()),
        )
        assert await anext(chunks) == b"init"
        await chunks.aclose()

    asyncio.run(cancel_after_first_chunk())

    assert process.terminated is True
    assert process.waits == [1]
    assert process.wait_thread_ids != [event_loop_thread]
    assert process.stdout.closed is True


def test_fmp4_route_closes_database_session_before_starting_ffmpeg(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeSession:
        closed = False

        def close(self) -> None:
            self.closed = True

    session = FakeSession()
    viewer = BroadcastViewerSettings(
        stream_title="Service",
        manual_live_audience="public",
        pre_service_minutes=60,
        starting_soon_message="Soon",
        offline_message="Offline",
    )
    process = FakeProcess([b"fragmented mp4", b""])
    inputs = [AudioMixInput("desk", "http://audio/desk.mp3", 0)]
    started: list[list[str]] = []
    monkeypatch.setattr("app.modules.broadcast.routes.viewer_settings", lambda _session: viewer)
    monkeypatch.setattr("app.modules.broadcast.routes.live_output_exists", lambda _session: False)
    monkeypatch.setattr(
        "app.modules.broadcast.routes.live_audio_mix_inputs", lambda _settings: inputs
    )
    monkeypatch.setattr("app.modules.broadcast.routes.allocate_control_port", lambda: 23456)

    def popen(command: list[str], **_kwargs: object) -> FakeProcess:
        assert session.closed is True
        started.append(command)
        return process

    monkeypatch.setattr("app.modules.broadcast.routes.subprocess.Popen", popen)

    response = live_audio_fmp4(
        SimpleNamespace(id="viewer"),  # type: ignore[arg-type]
        session,  # type: ignore[arg-type]
    )

    async def collect_chunks() -> list[bytes]:
        return [chunk async for chunk in response.body_iterator]

    chunks = asyncio.run(collect_chunks())

    assert chunks == [b"fragmented mp4"]
    assert started[0][started[0].index("-f") + 1] == "mp4"
    assert response.media_type == "audio/mp4"
    assert response.headers["cache-control"] == "no-store, no-transform"
    assert process.terminated is True
