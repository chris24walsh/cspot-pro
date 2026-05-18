from typing import Any

from fastapi import APIRouter, Depends

from app.modules.broadcast.obs_client import obs_status, run_obs_action
from app.modules.broadcast.schemas import ObsActionRead, ObsStatusRead
from app.modules.identity.auth import require_permission
from app.modules.identity.models import User

router = APIRouter()


@router.get("/obs/status", response_model=ObsStatusRead)
def get_obs_status(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsStatusRead:
    return obs_status()


@router.post("/obs/recording/start", response_model=ObsActionRead)
def start_obs_recording(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        status = client.get_record_status()
        if getattr(status, "output_active", False):
            return getattr(status, "output_path", None)
        response = client.start_record()
        return getattr(response, "output_path", None)

    status, output_path = run_obs_action("start recording", operation)
    return ObsActionRead(ok=True, action="start_recording", status=status, output_path=output_path)


@router.post("/obs/recording/stop", response_model=ObsActionRead)
def stop_obs_recording(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        status = client.get_record_status()
        if not getattr(status, "output_active", False):
            return getattr(status, "output_path", None)
        response = client.stop_record()
        return getattr(response, "output_path", None)

    status, output_path = run_obs_action("stop recording", operation)
    return ObsActionRead(ok=True, action="stop_recording", status=status, output_path=output_path)


@router.post("/obs/streaming/start", response_model=ObsActionRead)
def start_obs_streaming(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        status = client.get_stream_status()
        if not getattr(status, "output_active", False):
            client.start_stream()
        return None

    status, output_path = run_obs_action("start streaming", operation)
    return ObsActionRead(ok=True, action="start_streaming", status=status, output_path=output_path)


@router.post("/obs/streaming/stop", response_model=ObsActionRead)
def stop_obs_streaming(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        status = client.get_stream_status()
        if getattr(status, "output_active", False):
            client.stop_stream()
        return None

    status, output_path = run_obs_action("stop streaming", operation)
    return ObsActionRead(ok=True, action="stop_streaming", status=status, output_path=output_path)


@router.post("/obs/virtual-camera/start", response_model=ObsActionRead)
def start_obs_virtual_camera(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        try:
            status = client.get_virtual_cam_status()
            if getattr(status, "output_active", False):
                return None
        except Exception:
            pass
        client.start_virtual_cam()
        return None

    status, output_path = run_obs_action("start virtual camera", operation)
    return ObsActionRead(ok=True, action="start_virtual_camera", status=status, output_path=output_path)


@router.post("/obs/virtual-camera/stop", response_model=ObsActionRead)
def stop_obs_virtual_camera(
    _current_user: User = Depends(require_permission("broadcast:use")),
) -> ObsActionRead:
    def operation(client: Any) -> str | None:
        try:
            status = client.get_virtual_cam_status()
            if not getattr(status, "output_active", False):
                return None
        except Exception:
            pass
        client.stop_virtual_cam()
        return None

    status, output_path = run_obs_action("stop virtual camera", operation)
    return ObsActionRead(ok=True, action="stop_virtual_camera", status=status, output_path=output_path)
