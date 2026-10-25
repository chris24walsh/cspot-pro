"""One local UDP session shared by all dashboard clients; never write during sync."""

import asyncio
import ipaddress
import math
import struct
import time
from contextlib import suppress

from app.modules.mixer.catalog import PARAMETERS, STRIPS
from app.modules.mixer.effects import parameter_spec
from app.modules.mixer.osc import decode, encode, meters

# Recover dropped UDP reads for the desk surface without repeatedly querying
# unsupported optional DSP parameters or writing a default to live hardware.
FADER_READBACK_PATHS = (
    tuple(
        path
        for strip in sorted(STRIPS, key=lambda strip: strip["kind"] != "main")
        for root in [strip["id"] if strip["kind"] == "dca" else strip["id"] + "/mix"]
        for path in [root + "/fader", root + "/on"]
    )
    + tuple(
        path for path, spec in PARAMETERS.items()
        if (spec["group"] == "Sends" and path.endswith("/level"))
        or (spec["group"] == "Headamp" and path.endswith("/gain"))
        or path.startswith("/config/buslink/")
        or path.endswith((
            "/config/insrc", "/preamp/rtnsw", "/preamp/rtntrim",
            "/mix/pan", "/mix/lr", "/tap", "/grpon",
        ))
    )
)


def validate_host(host: str) -> str:
    address = ipaddress.IPv4Address(host)
    if (
        not address.is_private
        or address.is_loopback
        or address.is_multicast
        or str(address).endswith((".0", ".255"))
    ):
        raise ValueError("Use a private LAN IPv4 address for the mixer")
    return str(address)


def validate_value(path, value):
    spec = PARAMETERS.get(path)
    if not spec:
        raise ValueError("Unknown mixer parameter")
    if spec["kind"] == "string":
        if (
            not isinstance(value, str)
            or len(value.encode()) > 12
            or any(ord(c) < 32 for c in value)
        ):
            raise ValueError(
                "Mixer names must be at most 12 UTF-8 bytes without control characters"
            )
        return value
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError("Expected a finite numeric value")
    if spec["kind"] == "int":
        if int(value) != value or not spec["min"] <= value <= spec["max"]:
            raise ValueError("Integer parameter is out of range")
        return int(value)
    if not 0 <= value <= 1:
        raise ValueError("OSC float must be normalized from 0 to 1")
    return float(value)


STARTUP_MUTE_PATHS = tuple(
    strip["id"] + "/mix/on" for strip in STRIPS
    if strip["kind"] in {"input", "aux", "return"}
)


class MixerEngine(asyncio.DatagramProtocol):
    def __init__(self):
        self.startup_scene_hold = False
        self.startup_mute_remaining = set()
        self.host = None
        self.transport = None
        self.task = None
        self.sync_task = None
        self.readback_task = None
        self.values = {}
        self.levels = []
        self.identity = []
        self.last_seen = 0
        self.last_meter = 0
        self.pending = {}
        self.pending_origins = {}
        self.failed = {}
        self.fx_specs = {}
        self.revision = 0
        self.syncing = False
        self.synchronized = False
        self.recalling = False
        self.error = None
        self.lock = asyncio.Lock()

    @property
    def startup_muting(self):
        return bool(self.startup_mute_remaining)

    def arm_startup_mute(self):
        self.startup_scene_hold = True
        self.startup_mute_remaining = set(STARTUP_MUTE_PATHS)

    async def apply_startup_mute(self):
        if not self.startup_muting or not self.connected:
            return
        for path in tuple(self.startup_mute_remaining):
            if path not in self.values:
                self.send(path)
            elif self.values[path] == 0:
                self.startup_mute_remaining.discard(path)
            elif path not in self.pending:
                await self.write(path, 0, origin="startup")

    @property
    def connected(self):
        return (
            self.transport is not None
            and time.monotonic() - self.last_seen < 5
            and bool(self.identity)
        )

    def datagram_received(self, data, addr):
        if addr != (self.host, 10024):
            return
        try:
            path, args = decode(data)
            if path == "/xinfo" and len(args) >= 4:
                if not str(args[2]).startswith(("XR18", "X18")):
                    self.error = "The responding device is not an XR18/X18"
                    return
                self.error = None
                self.identity = args
                self.last_seen = time.monotonic()
            elif path.startswith("/meters/") and args and isinstance(args[0], bytes):
                self.levels = meters(args[0])
                self.last_meter = time.monotonic()
                self.last_seen = time.monotonic()
            elif path in PARAMETERS and args:
                is_fx = path.startswith("/fx/") and "/par/" in path
                if is_fx and isinstance(args[0], int) and 0 <= args[0] <= 127:
                    pass
                else:
                    validate_value(path, args[0])
                if (
                    path.startswith("/fx/")
                    and path.endswith("/type")
                    and self.values.get(path) != args[0]
                ):
                    root = path.rsplit("/", 1)[0] + "/par/"
                    for old in [p for p in self.values if p.startswith(root)]:
                        self.values.pop(old, None)
                        self.fx_specs.pop(old, None)
                        self.pending.pop(old, None)
                        self.pending_origins.pop(old, None)
                    asyncio.create_task(self.refresh_fx(root))
                if is_fx:
                    algorithm = self.values.get(path.split("/par/")[0] + "/type", -1)
                    self.fx_specs[path] = parameter_spec(PARAMETERS[path], algorithm, args[0])
                self.values[path] = args[0]
                if args[0] == 0:
                    self.startup_mute_remaining.discard(path)
                elif self.startup_muting and path in STARTUP_MUTE_PATHS:
                    self.startup_mute_remaining.add(path)
                self.last_seen = time.monotonic()
                pending = self.pending.get(path)
                if pending and (
                    args[0] == pending[0]
                    or isinstance(args[0], float)
                    and abs(args[0] - pending[0]) < 0.002
                ):
                    self.pending.pop(path, None)
                    self.pending_origins.pop(path, None)
                self.failed.pop(path, None)
            else:
                return
            self.revision += 1
        except (ValueError, IndexError, UnicodeError, TypeError, OverflowError, struct.error):
            return

    def error_received(self, exc):
        self.error = str(exc)

    def send(self, path, *args):
        if self.transport and self.host:
            self.transport.sendto(encode(path, *args), (self.host, 10024))

    async def configure(self, host):
        async with self.lock:
            if host == self.host and self.task and not self.task.done():
                return
            await self.stop()
            self.host = host
            if self.startup_muting:
                self.arm_startup_mute()
            self.values, self.pending, self.failed, self.levels, self.identity = {}, {}, {}, [], []
            self.pending_origins = {}
            self.last_seen = self.last_meter = 0
            self.error = None
            self.synchronized = False
            self.fx_specs = {}
            self.revision += 1
            if host:
                self.transport, _ = await asyncio.get_running_loop().create_datagram_endpoint(
                    lambda: self, local_addr=("0.0.0.0", 0)
                )
                self.task = asyncio.create_task(self.run())

    async def stop(self):
        for task in (self.task, self.sync_task, self.readback_task):
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        self.task = self.sync_task = self.readback_task = None
        self.syncing = False
        if self.transport:
            self.transport.close()
            self.transport = None

    async def refresh_fx(self, root):
        # Let the new algorithm settle before reading its parameter types and values.
        await asyncio.sleep(0.1)
        for i in range(1, 65):
            self.send(root + f"{i:02}")
            await asyncio.sleep(0.004)

    async def synchronize(self):
        self.syncing = True
        self.synchronized = False
        try:
            # Read the most useful controls first. Pace UDP to avoid overflowing desk buffers.
            paths = sorted(
                PARAMETERS,
                key=lambda p: (not (p.endswith(("/fader", "/on", "/name", "/color"))), p),
            )
            for path in paths:
                self.send(path)
                await asyncio.sleep(0.004)
            self.synchronized = self.connected
        finally:
            self.syncing = False

    async def refresh_missing_controls(self):
        """Retry unanswered strip controls; never change desk settings."""
        for path in FADER_READBACK_PATHS:
            if not self.connected or self.recalling:
                return
            if path not in self.values:
                self.send(path)
                await asyncio.sleep(0.01)

    async def run(self):
        ticks = 0
        was_connected = False
        while True:
            if ticks % 8 == 0:
                self.send("/xinfo")
            if ticks % 12 == 0:
                self.send("/xremote")
                self.send("/meters", "/meters/1")
            if self.connected and not was_connected:
                if not self.sync_task or self.sync_task.done():
                    self.sync_task = asyncio.create_task(self.synchronize())
            if (
                ticks % 12 == 0
                and self.connected
                and not self.recalling
                and (not self.sync_task or self.sync_task.done())
                and (not self.readback_task or self.readback_task.done())
            ):
                self.readback_task = asyncio.create_task(self.refresh_missing_controls())
            if was_connected and not self.connected:
                self.synchronized = False
                if self.startup_muting:
                    self.arm_startup_mute()
                self.values.clear()
                self.fx_specs.clear()
                self.levels = []
                for path in self.pending:
                    self.failed[path] = "Connection lost before confirmation"
                self.pending.clear()
                self.pending_origins.clear()
            if ticks % 4 == 0:
                await self.apply_startup_mute()
            was_connected = self.connected
            now = time.monotonic()
            for path, (value, started, retries) in list(self.pending.items()):
                if now - started > 1:
                    if retries >= 2 or not self.connected:
                        self.pending.pop(path, None)
                        self.pending_origins.pop(path, None)
                        self.failed[path] = "No matching readback from mixer"
                    else:
                        self.send(path, value)
                        self.send(path)
                        self.pending[path] = (value, now, retries + 1)
            ticks += 1
            await asyncio.sleep(0.25)

    def command_value(self, path, value):
        if self.startup_muting and not (path in STARTUP_MUTE_PATHS and value == 0):
            raise ValueError("Startup mute is awaiting confirmation for all input channels")
        if path in self.fx_specs and self.fx_specs[path]["kind"] == "int":
            if (
                not isinstance(value, (int, float))
                or not math.isfinite(value)
                or int(value) != value
                or not 0 <= value <= self.fx_specs[path]["max"]
            ):
                raise ValueError("FX enum parameter out of range")
            value = int(value)
        else:
            value = validate_value(path, value)
        if not self.connected:
            raise ValueError("Mixer is offline; reconnect before changing controls")
        if path not in self.values:
            raise ValueError("Parameter has not been read from this mixer")
        return value

    async def write(self, path, value, *, origin="manual"):
        value = self.command_value(path, value)
        if origin == "manual" and path in STARTUP_MUTE_PATHS and value == 1:
            self.startup_scene_hold = False
        self.pending[path] = (value, time.monotonic(), 0)
        self.pending_origins[path] = origin
        self.failed.pop(path, None)
        self.send(path, value)
        self.send(path)

    def snapshot(self):
        return dict(
            startup_muting=self.startup_muting,
            startup_scene_hold=self.startup_scene_hold,
            host=self.host,
            connected=self.connected,
            identity=self.identity,
            values=self.values.copy(),
            meters=self.levels if time.monotonic() - self.last_meter < 2 else [],
            fx_specs=self.fx_specs.copy(),
            pending=list(self.pending),
            failed=self.failed.copy(),
            syncing=self.syncing,
            synchronized=self.synchronized,
            recalling=self.recalling,
            revision=self.revision,
            error=self.error,
            age_ms=round((time.monotonic() - self.last_seen) * 1000) if self.last_seen else None,
        )


engine = MixerEngine()


class MixerDiscovery(asyncio.DatagramProtocol):
    def __init__(self, hosts):
        self.hosts = set(hosts)
        self.found = {}

    def datagram_received(self, data, addr):
        if addr[1] != 10024 or ("255.255.255.255" not in self.hosts and addr[0] not in self.hosts):
            return
        try:
            path, args = decode(data)
            if path == "/xinfo" and len(args) >= 4 and str(args[2]).startswith(("XR18", "X18")):
                self.found[addr[0]] = dict(
                    host=addr[0], name=args[1], model=args[2], firmware=args[3]
                )
        except (ValueError, IndexError, UnicodeError, TypeError, struct.error):
            # Unrelated or malformed LAN traffic must not abort the scan.
            return


async def discover(hosts: list[str]):
    """Read-only broadcast/unicast discovery, compatible with asyncio and uvloop."""
    transport, protocol = await asyncio.get_running_loop().create_datagram_endpoint(
        lambda: MixerDiscovery(hosts), local_addr=("0.0.0.0", 0), allow_broadcast=True
    )
    try:
        for host in hosts:
            with suppress(OSError):
                transport.sendto(encode("/xinfo"), (host, 10024))
        await asyncio.sleep(2)
        return list(protocol.found.values())
    finally:
        transport.close()
