"""Server-owned ONVIF cruise; short command leases stop motion on process failure."""
import base64
import hashlib
import json
import logging
import math
import secrets
import threading
import time
from datetime import UTC, datetime
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

import requests

from app.core.config import settings


class Cruise:
    def __init__(self, camera_id="default"):
        self.camera_id = camera_id
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.worker = None
        self.error = None
        self.endpoint = None
        self.profile = None

    def connection(self):
        if self.camera_id == "default":
            return {"host": settings.ptz_host, "port": settings.ptz_port,
                    "username": settings.ptz_username, "password": settings.ptz_password}
        return camera_connections()[self.camera_id]

    def soap(self, endpoint, namespace, operation, content=""):
        connection = self.connection()
        nonce = secrets.token_bytes(16)
        created = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
        digest = base64.b64encode(hashlib.sha1(
            nonce + created.encode() + connection["password"].encode()
        ).digest()).decode()
        wsse = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
        wsu = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"
        body = f'''<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
          xmlns:t="{namespace}" xmlns:tt="http://www.onvif.org/ver10/schema">
          <s:Header><ws:Security xmlns:ws="{wsse}" xmlns:u="{wsu}">
          <ws:UsernameToken><ws:Username>{escape(connection.get("username", "admin"))}</ws:Username>
          <ws:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">{digest}</ws:Password>
          <ws:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">{base64.b64encode(nonce).decode()}</ws:Nonce>
          <u:Created>{created}</u:Created></ws:UsernameToken></ws:Security></s:Header>
          <s:Body><t:{operation}>{content}</t:{operation}></s:Body></s:Envelope>'''
        response = requests.post(endpoint, data=body.encode(), headers={
            "Content-Type": f'application/soap+xml; charset=utf-8; action="{namespace}/{operation}"'
        }, timeout=5)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        if root.find(".//{http://www.w3.org/2003/05/soap-envelope}Fault") is not None:
            raise ValueError("Camera rejected the ONVIF command")
        return root

    def discover(self):
        connection = self.connection()
        if not connection.get("host") or not connection.get("password"):
            raise ValueError("Configure PTZ_HOST, PTZ_USERNAME and PTZ_PASSWORD on the API server")
        device_url = (f"http://{connection['host']}:{connection.get('port', 80)}"
                      "/onvif/device_service")
        root = self.soap(device_url,
                         "http://www.onvif.org/ver10/device/wsdl", "GetCapabilities",
                         "<t:Category>All</t:Category>")
        ns = "{http://www.onvif.org/ver10/schema}"
        ptz = root.find(f".//{ns}PTZ/{ns}XAddr")
        media = root.find(f".//{ns}Media/{ns}XAddr")
        if ptz is None or media is None:
            raise ValueError("Camera did not advertise ONVIF PTZ and media services")
        self.endpoint = ptz.text
        profiles = self.soap(media.text, "http://www.onvif.org/ver10/media/wsdl", "GetProfiles")
        profile = next((p for p in profiles.iter() if p.tag.endswith("}Profiles")
                        and p.find(f"{ns}PTZConfiguration") is not None), None)
        if profile is None:
            raise ValueError("Camera has no PTZ-enabled media profile")
        self.profile = profile.attrib["token"]
        configuration = profile.find(f"{ns}PTZConfiguration").attrib["token"]
        options = self.soap(self.endpoint, "http://www.onvif.org/ver20/ptz/wsdl",
                            "GetConfigurationOptions",
                            f"<t:ConfigurationToken>{escape(configuration)}</t:ConfigurationToken>")
        space = options.find(f".//{ns}ContinuousPanTiltVelocitySpace")
        if space is None:
            raise ValueError("Camera does not support continuous pan movement")
        timeout_range = options.find(f".//{ns}PTZTimeout/{ns}Min")
        # We require a short lease so a dead controller cannot leave the camera moving.
        if timeout_range is not None and timeout_range.text not in ("PT0S", "PT1S", "PT2S"):
            raise ValueError("Camera requires a movement timeout longer than the cruise lease")
        minimum = float(space.find(f"{ns}XRange/{ns}Min").text)
        maximum = float(space.find(f"{ns}XRange/{ns}Max").text)
        if minimum > -0.2 or maximum < 0.2:
            raise ValueError("Camera velocity range is incompatible with normalized cruise speeds")
        return space.find(f"{ns}URI").text

    def command(self, operation, content=""):
        return self.soap(self.endpoint, "http://www.onvif.org/ver20/ptz/wsdl", operation,
                         f"<t:ProfileToken>{escape(self.profile)}</t:ProfileToken>" + content)

    def stop(self):
        self.cancel.set()
        if self.worker:
            self.worker.join(timeout=7)
            if self.worker.is_alive():
                raise ValueError("Cruise is still stopping; retry shortly")
        self.worker = None
        if self.endpoint and self.profile:
            self.command("Stop", "<t:PanTilt>true</t:PanTilt><t:Zoom>true</t:Zoom>")

    def start(self, speed, sweep_seconds):
        self.stop()
        space = self.discover()
        self.error = None
        self.cancel = threading.Event()
        # Start synchronously so connection/authentication errors reach the operator.
        self.command("ContinuousMove", self.velocity(speed, space))
        self.worker = threading.Thread(target=self.run, args=(speed, sweep_seconds, space),
                                       daemon=True)
        self.worker.start()

    @staticmethod
    def velocity(speed, space):
        return (f'<t:Velocity><tt:PanTilt x="{speed:.5f}" y="0" '
                f'space="{escape(space)}" /></t:Velocity><t:Timeout>PT2S</t:Timeout>')

    def run(self, speed, sweep_seconds, space):
        started = time.monotonic()
        try:
            while not self.cancel.wait(0.5):
                elapsed = time.monotonic() - started
                # Mostly constant movement, easing through each reversal.
                velocity = speed * math.tanh(4 * math.cos(math.pi * elapsed / sweep_seconds))
                self.command("ContinuousMove", self.velocity(velocity, space))
        except Exception:
            self.error = "Cruise stopped after an ONVIF communication error"
        finally:
            try:
                self.command("Stop", "<t:PanTilt>true</t:PanTilt><t:Zoom>true</t:Zoom>")
            except Exception:
                self.error = "Camera stop unconfirmed; movement lease expires in 2 seconds"

    def status(self):
        return {"running": bool(self.worker and self.worker.is_alive()), "error": self.error}


cruise = Cruise()


_registry_lock = threading.Lock()
_controllers = {"default": cruise}


def camera_connections():
    try:
        devices = json.loads(getattr(settings, "ptz_cameras_json", "{}"))
    except (ValueError, TypeError) as exc:
        raise ValueError("PTZ_CAMERAS_JSON is invalid") from exc
    if not isinstance(devices, dict):
        raise ValueError("PTZ_CAMERAS_JSON must be an object keyed by camera ID")
    for camera_id, config in devices.items():
        if camera_id == "default" or not isinstance(config, dict):
            raise ValueError("Additional PTZ cameras require unique IDs and connection objects")
        if not all(isinstance(config.get(key), str) and config[key]
                   for key in ("host", "password")):
            raise ValueError("Additional PTZ cameras require a host and password")
        if not isinstance(config.get("username", "admin"), str):
            raise ValueError("PTZ camera username must be a string")
        if not isinstance(config.get("port", 80), int) or not 1 <= config.get("port", 80) <= 65535:
            raise ValueError("PTZ camera port must be between 1 and 65535")
    return devices


def ptz_devices():
    return [{"id": "default", "label": "Original room PTZ"}] + [
        {"id": camera_id, "label": config.get("label", camera_id)}
        for camera_id, config in camera_connections().items() if camera_id != "default"
    ]


def get_cruise(camera_id="default"):
    if camera_id != "default" and camera_id not in camera_connections():
        raise ValueError("ONVIF camera is not configured")
    with _registry_lock:
        if camera_id not in _controllers:
            _controllers[camera_id] = Cruise(camera_id)
        return _controllers[camera_id]


def stop_cruises():
    with _registry_lock:
        controllers = list(_controllers.values())
    for controller in controllers:
        with controller.lock:
            try:
                controller.stop()
            except Exception:
                logging.getLogger(__name__).warning("Could not confirm camera stop during shutdown")
