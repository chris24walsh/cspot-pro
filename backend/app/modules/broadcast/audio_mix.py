from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from app.core.config import settings as app_settings
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.settings import (
    effective_audio_source,
    selected_camera_url,
    selected_independent_audio_sources,
)


@dataclass(frozen=True)
class AudioMixInput:
    source_id: str
    url: str
    gain_db: float = 0
    channels: int = 1


def audio_mix_inputs(settings: BroadcastViewerSettings) -> list[AudioMixInput]:
    independent = selected_independent_audio_sources(settings)
    if independent:
        return [
            AudioMixInput(
                source_id=source.id,
                url=source.url.strip(),
                gain_db=0,
                channels=2,
            )
            for source in independent
            if source.url.strip().startswith(("http://", "https://"))
        ]

    if effective_audio_source(settings) == "none":
        return []
    camera_url = (selected_camera_url(settings) or "").strip()
    if camera_url.startswith("/app/camera/"):
        if not app_settings.camera_proxy_upstream:
            return []
        camera_url = urljoin(app_settings.camera_proxy_upstream.rstrip("/") + "/", camera_url[12:])
    if camera_url.startswith(("http://", "https://", "rtsp://")):
        return [AudioMixInput(source_id="camera", url=camera_url)]
    return []


def live_audio_mix_inputs(settings: BroadcastViewerSettings) -> list[AudioMixInput]:
    """Open only on-air feeds: an offline muted input must not block playback."""
    return audio_mix_inputs(settings)


def audio_mix_signature(inputs: list[AudioMixInput]) -> tuple[tuple[str, str, float, int], ...]:
    return tuple(
        (source.source_id, source.url, source.gain_db, source.channels) for source in inputs
    )


def ffmpeg_audio_input_args(inputs: list[AudioMixInput]) -> list[str]:
    arguments: list[str] = []
    for source in inputs:
        # Bridge MP3 feeds use explicit demuxing and minimal probing to avoid
        # accumulating buffered audio before the single-feed relay starts.
        arguments.extend(["-thread_queue_size", "1024"])
        if urlsplit(source.url).path.lower().endswith(".mp3"):
            arguments.extend(
                [
                    "-fflags",
                    "+nobuffer",
                    "-analyzeduration",
                    "0",
                    "-probesize",
                    "32",
                    "-f",
                    "mp3",
                ]
            )
        arguments.extend(["-i", source.url])
    return arguments


def ffmpeg_audio_filter_args(
    inputs: list[AudioMixInput], *, reset_timestamps: bool = False
) -> list[str]:
    if len(inputs) != 1 or inputs[0].gain_db != 0:
        raise ValueError("Software audio mixing is retired; select one unity-gain program feed")
    return ["-map", "0:a:0", *(["-af", "asetpts=N/SR/TB"] if reset_timestamps else [])]


def ffmpeg_live_mix_command(inputs: list[AudioMixInput]) -> list[str]:
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        *ffmpeg_audio_input_args(inputs),
        "-vn",
        *ffmpeg_audio_filter_args(inputs),
        "-ac",
        str(max(source.channels for source in inputs)),
        "-ar",
        "48000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k" if any(source.channels == 2 for source in inputs) else "96k",
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


def ffmpeg_live_mix_fmp4_command(inputs: list[AudioMixInput]) -> list[str]:
    """Build the browser-MSE program relay with short, independently appendable fragments."""
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        *ffmpeg_audio_input_args(inputs),
        "-vn",
        *ffmpeg_audio_filter_args(inputs),
        "-ac",
        str(max(source.channels for source in inputs)),
        "-ar",
        "48000",
        "-c:a",
        "aac",
        "-profile:a",
        "aac_low",
        "-b:a",
        "192k" if any(source.channels == 2 for source in inputs) else "96k",
        # An empty movie header lets MediaSource start before FFmpeg exits.
        # Keeping fragments near 200 ms gives the browser enough packet depth
        # to decode without letting the transport build seconds of latency.
        "-movflags",
        "+empty_moov+default_base_moof+frag_keyframe",
        "-frag_duration",
        "200000",
        "-flush_packets",
        "1",
        "-f",
        "mp4",
        "pipe:1",
    ]


def ffmpeg_recording_mix_command(inputs: list[AudioMixInput], file_path: Path) -> list[str]:
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
        str(max(source.channels for source in inputs)),
        "-c:a",
        "libopus",
        "-b:a",
        "96k" if any(source.channels == 2 for source in inputs) else "48k",
        str(file_path),
    ]
