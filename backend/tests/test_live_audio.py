import shutil
import subprocess
import time

import pytest

from app.modules.broadcast.audio_mix import AudioMixInput
from app.modules.broadcast.live_audio import (
    allocate_control_port,
    register_live_audio_control,
    unregister_live_audio_control,
    update_live_audio_controls,
)


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
        assert update_live_audio_controls(
            [AudioMixInput(source_id="desk", url="test://desk", gain_db=-12)]
        ) == 1
        assert process.poll() is None
    finally:
        unregister_live_audio_control(control)
        process.terminate()
        process.wait(timeout=5)
