from types import SimpleNamespace
from xml.etree import ElementTree as ET

import pytest

from app.modules.broadcast import ptz
from app.modules.broadcast.schemas import BroadcastCameraSource


def test_crop_limits():
    source = BroadcastCameraSource(id="close", label="Close", url="one", zoom=2, b_roll=True)
    assert source.model_dump()["b_roll"] is True
    with pytest.raises(ValueError):
        BroadcastCameraSource(id="close", label="Close", url="one", zoom=5)


def test_velocity_has_short_lease_and_no_tilt():
    content = ptz.Cruise.velocity(0.03, "urn:velocity")
    assert 'x="0.03000" y="0"' in content
    assert "<t:Timeout>PT2S</t:Timeout>" in content


def test_discovery_rejects_camera_without_continuous_pan(monkeypatch):
    monkeypatch.setattr(ptz, "settings", SimpleNamespace(
        ptz_host="camera", ptz_port=80, ptz_password="test", ptz_username="admin"))
    ns = "http://www.onvif.org/ver10/schema"
    responses = iter([
        ET.fromstring(f'<root xmlns:tt="{ns}"><tt:PTZ><tt:XAddr>ptz</tt:XAddr></tt:PTZ><tt:Media><tt:XAddr>media</tt:XAddr></tt:Media></root>'),
        ET.fromstring(f'<root xmlns:m="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="{ns}"><m:Profiles token="profile"><tt:PTZConfiguration token="config" /></m:Profiles></root>'),
        ET.fromstring('<root />'),
    ])
    controller = ptz.Cruise()
    monkeypatch.setattr(controller, "soap", lambda *args: next(responses))
    with pytest.raises(ValueError, match="continuous pan"):
        controller.discover()


def test_worker_stops_after_communication_failure(monkeypatch):
    controller = ptz.Cruise()
    monkeypatch.setattr(controller.cancel, "wait", lambda timeout: False)
    commands = []
    def command(operation, content):
        commands.append(operation)
        if operation == "ContinuousMove":
            raise RuntimeError("camera disconnected")
    monkeypatch.setattr(controller, "command", command)
    controller.run(0.03, 30, "urn:velocity")
    assert commands == ["ContinuousMove", "Stop"]
    assert "communication error" in controller.error


def test_sample_is_blocked_during_broadcast(monkeypatch):
    from fastapi import HTTPException
    from app.modules.broadcast import routes
    monkeypatch.setattr(routes, "viewer_settings", lambda session: SimpleNamespace(manual_live_audience="public"))
    with pytest.raises(HTTPException) as error:
        routes.sample_ptz_angle(routes.PTZSampleRequest(direction="left"), None, None)
    assert error.value.status_code == 409


def test_sample_stops_even_when_start_fails(monkeypatch):
    from fastapi import HTTPException
    from app.modules.broadcast import routes
    monkeypatch.setattr(routes, "viewer_settings", lambda session: SimpleNamespace(manual_live_audience="off"))
    monkeypatch.setattr(routes, "live_output_exists", lambda session: False)
    stopped = []
    def fail(*args):
        raise RuntimeError("camera error")
    monkeypatch.setattr(ptz.cruise, "start", fail)
    monkeypatch.setattr(ptz.cruise, "stop", lambda: stopped.append(True))
    with pytest.raises(HTTPException):
        routes.sample_ptz_angle(routes.PTZSampleRequest(direction="right"), None, None)
    assert stopped == [True]


def test_multiple_ptz_devices_are_isolated(monkeypatch):
    import json
    monkeypatch.setattr(ptz, "settings", SimpleNamespace(
        ptz_cameras_json=json.dumps({"side": {"host": "new-camera", "password": "private", "label": "Side PTZ"}})))
    monkeypatch.setattr(ptz, "_controllers", {"default": ptz.cruise})
    side = ptz.get_cruise("side")
    assert side is not ptz.cruise
    assert ptz.get_cruise("side") is side
    assert side.connection()["host"] == "new-camera"
    assert ptz.ptz_devices() == [
        {"id": "default", "label": "Original room PTZ"},
        {"id": "side", "label": "Side PTZ"},
    ]
    with pytest.raises(ValueError, match="not configured"):
        ptz.get_cruise("unknown")


def test_invalid_device_configuration_does_not_expose_secrets(monkeypatch):
    import json
    monkeypatch.setattr(ptz, "settings", SimpleNamespace(
        ptz_cameras_json=json.dumps({"side": {"password": "private-camera-password"}})))
    with pytest.raises(ValueError) as error:
        ptz.camera_connections()
    assert "private-camera-password" not in str(error.value)
