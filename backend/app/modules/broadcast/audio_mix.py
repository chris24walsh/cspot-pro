from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

from app.core.config import settings as app_settings
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.settings import (
    audio_sources,
    effective_audio_source,
    selected_camera_url,
    selected_independent_audio_sources,
)


@dataclass(frozen=True)
class AudioMixInput:
    source_id: str
    url: str
    gain_db: float = 0


def audio_mix_inputs(settings: BroadcastViewerSettings) -> list[AudioMixInput]:
    independent = selected_independent_audio_sources(settings)
    if independent:
        return [
            AudioMixInput(source_id=source.id, url=source.url.strip(), gain_db=source.gain_db)
            for source in independent
            if source.url.strip().startswith(("http://", "https://"))
        ]

    camera_url = (selected_camera_url(settings) or "").strip()
    if camera_url.startswith("/app/camera/"):
        if not app_settings.camera_proxy_upstream:
            return []
        camera_url = urljoin(
            app_settings.camera_proxy_upstream.rstrip("/") + "/", camera_url[12:]
        )
    if camera_url.startswith(("http://", "https://", "rtsp://")):
        return [AudioMixInput(source_id="camera", url=camera_url)]
    return []


def live_audio_mix_inputs(settings: BroadcastViewerSettings) -> list[AudioMixInput]:
    """Keep every configured input open so its level can change at runtime."""
    independent = [
        source for source in audio_sources(settings)
        if source.url.strip().startswith(("http://", "https://"))
    ]
    if not independent:
        return audio_mix_inputs(settings)
    selected = effective_audio_source(settings, [], independent)
    return [
        AudioMixInput(
            source_id=source.id,
            url=source.url.strip(),
            gain_db=(
                source.gain_db
                if (selected == "mix" and source.mix_enabled) or selected == source.id
                else -120
            ),
        )
        for source in independent
    ]


def audio_mix_signature(inputs: list[AudioMixInput]) -> tuple[tuple[str, str, float], ...]:
    return tuple((source.source_id, source.url, source.gain_db) for source in inputs)


def ffmpeg_audio_input_args(inputs: list[AudioMixInput]) -> list[str]:
    arguments: list[str] = []
    for source in inputs:
        arguments.extend(["-thread_queue_size", "1024", "-i", source.url])
    return arguments


def ffmpeg_audio_filter_args(
    inputs: list[AudioMixInput], *, reset_timestamps: bool = False, control_port: int | None = None
) -> list[str]:
    if control_port is None and len(inputs) == 1 and abs(inputs[0].gain_db) < 0.01:
        return ["-map", "0:a:0", *(["-af", "asetpts=N/SR/TB"] if reset_timestamps else [])]

    filters = [
        f"[{index}:a:0]aresample=48000,volume@input{index}={source.gain_db:g}dB[input{index}]"
        for index, source in enumerate(inputs)
    ]
    labels = "".join(f"[input{index}]" for index in range(len(inputs)))
    timestamp_filter = ",asetpts=N/SR/TB" if reset_timestamps else ""
    if len(inputs) == 1:
        output = f"{labels}alimiter=limit=0.95{timestamp_filter}"
    else:
        output = (
            f"{labels}amix=inputs={len(inputs)}:duration=longest:"
            "dropout_transition=2:normalize=0,alimiter=limit=0.95"
            f"{timestamp_filter}"
        )
    if control_port is not None:
        # The filter graph parser consumes one escaping layer before azmq
        # parses its endpoint, so the argument passed to FFmpeg needs two.
        output += f",azmq=b=tcp\\\\://127.0.0.1\\\\:{control_port}"
    filters.append(f"{output}[audio]")
    return ["-filter_complex", ";".join(filters), "-map", "[audio]"]


def ffmpeg_live_mix_command(
    inputs: list[AudioMixInput], control_port: int | None = None
) -> list[str]:
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        *ffmpeg_audio_input_args(inputs),
        "-vn",
        *ffmpeg_audio_filter_args(inputs, control_port=control_port),
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "96k",
        "-reservoir",
        "0",
        "-flush_packets",
        "1",
        "-write_xing",
        "0",
        "-f",
        "mp3",
        "pipe:1",
    ]


def ffmpeg_recording_mix_command(
    inputs: list[AudioMixInput], file_path: Path
) -> list[str]:
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *ffmpeg_audio_input_args(inputs),
        "-vn",
        *ffmpeg_audio_filter_args(inputs, reset_timestamps=True),
        "-ac",
        "1",
        "-c:a",
        "libopus",
        "-b:a",
        "48k",
        str(file_path),
    ]
