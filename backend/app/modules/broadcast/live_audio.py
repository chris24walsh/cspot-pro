import logging
import socket
from dataclasses import dataclass
from threading import Lock

import zmq

from app.modules.broadcast.audio_mix import AudioMixInput

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LiveAudioControl:
    port: int
    inputs: tuple[AudioMixInput, ...]


_controls: set[LiveAudioControl] = set()
_lock = Lock()


def allocate_control_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def register_live_audio_control(port: int, inputs: list[AudioMixInput]) -> LiveAudioControl:
    control = LiveAudioControl(port=port, inputs=tuple(inputs))
    with _lock:
        _controls.add(control)
    return control


def unregister_live_audio_control(control: LiveAudioControl) -> None:
    with _lock:
        _controls.discard(control)


def _same_sources(left: tuple[AudioMixInput, ...], right: list[AudioMixInput]) -> bool:
    return [(item.source_id, item.url) for item in left] == [
        (item.source_id, item.url) for item in right
    ]


def update_live_audio_controls(inputs: list[AudioMixInput]) -> int:
    """Apply new gains to compatible running relays without replacing their streams."""
    with _lock:
        controls = [control for control in _controls if _same_sources(control.inputs, inputs)]
    updated = 0
    context = zmq.Context.instance()
    for control in controls:
        client = context.socket(zmq.REQ)
        client.setsockopt(zmq.LINGER, 0)
        client.setsockopt(zmq.RCVTIMEO, 500)
        client.setsockopt(zmq.SNDTIMEO, 500)
        try:
            client.connect(f"tcp://127.0.0.1:{control.port}")
            for index, source in enumerate(inputs):
                client.send_string(f"volume@input{index} volume {source.gain_db:g}dB")
                response = client.recv_string()
                if not response.startswith("0 "):
                    raise RuntimeError(response)
            updated += 1
        except (RuntimeError, zmq.ZMQError):
            logger.warning("Could not update a running live audio relay", exc_info=True)
        finally:
            client.close()
    return updated
