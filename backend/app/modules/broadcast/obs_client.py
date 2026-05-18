from collections.abc import Callable
from typing import Any

from fastapi import HTTPException, status

from app.core.config import settings
from app.modules.broadcast.schemas import ObsStatusRead

try:
    import obsws_python as obsws
except ImportError:  # pragma: no cover - only hit if optional package install is skipped.
    obsws = None


def _response_value(response: Any, *names: str) -> Any:
    for name in names:
        if hasattr(response, name):
            return getattr(response, name)
        if isinstance(response, dict) and name in response:
            return response[name]
    return None


def _obs_unavailable_status(error: str | None = None) -> ObsStatusRead:
    return ObsStatusRead(
        configured=settings.obs_websocket_configured,
        connected=False,
        host=settings.obs_websocket_host,
        port=settings.obs_websocket_port,
        error=error,
    )


def _connect():
    if not settings.obs_websocket_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OBS WebSocket is not configured. Set OBS_WEBSOCKET_HOST and restart the API.",
        )
    if obsws is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OBS WebSocket client package is not installed. Rebuild the API image.",
        )
    try:
        return obsws.ReqClient(
            host=settings.obs_websocket_host,
            port=settings.obs_websocket_port,
            password=settings.obs_websocket_password or "",
            timeout=settings.obs_websocket_timeout,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not connect to OBS WebSocket: {exc}",
        ) from exc


def obs_status() -> ObsStatusRead:
    if not settings.obs_websocket_configured:
        return _obs_unavailable_status("OBS WebSocket is not configured.")
    if obsws is None:
        return _obs_unavailable_status("OBS WebSocket client package is not installed.")

    client = None
    try:
        client = _connect()
        version = client.get_version()
        record_status = client.get_record_status()
        stream_status = client.get_stream_status()
        try:
            virtual_camera_status = client.get_virtual_cam_status()
        except Exception:
            virtual_camera_status = None

        return ObsStatusRead(
            configured=True,
            connected=True,
            host=settings.obs_websocket_host,
            port=settings.obs_websocket_port,
            obs_version=_response_value(version, "obs_version", "obsVersion"),
            websocket_version=_response_value(version, "obs_web_socket_version", "obsWebSocketVersion"),
            recording=bool(_response_value(record_status, "output_active", "outputActive")),
            recording_paused=bool(_response_value(record_status, "output_paused", "outputPaused")),
            recording_timecode=_response_value(record_status, "output_timecode", "outputTimecode"),
            recording_path=_response_value(record_status, "output_path", "outputPath"),
            streaming=bool(_response_value(stream_status, "output_active", "outputActive")),
            streaming_timecode=_response_value(stream_status, "output_timecode", "outputTimecode"),
            virtual_camera=bool(
                _response_value(virtual_camera_status, "output_active", "outputActive")
            )
            if virtual_camera_status is not None
            else False,
        )
    except HTTPException:
        raise
    except Exception as exc:
        return _obs_unavailable_status(str(exc))
    finally:
        if client is not None and hasattr(client, "disconnect"):
            client.disconnect()


def run_obs_action(action: str, operation: Callable[[Any], str | None]) -> tuple[ObsStatusRead, str | None]:
    client = _connect()
    try:
        output_path = operation(client)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OBS action failed while trying to {action}: {exc}",
        ) from exc
    finally:
        if hasattr(client, "disconnect"):
            client.disconnect()

    return obs_status(), output_path
