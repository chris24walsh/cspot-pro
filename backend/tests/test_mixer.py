import asyncio
import math
import struct
import time

import pytest

from app.modules.mixer.catalog import PARAMETERS
from app.modules.mixer.engine import MixerEngine, validate_host, validate_value
from app.modules.mixer.osc import decode, encode, meters, string


def test_osc_padding_types_and_invalid_packets():
    packet = encode("/ch/01/test", 1, 0.5, "Hello")
    assert len(packet) % 4 == 0
    assert decode(packet) == ("/ch/01/test", [1, 0.5, "Hello"])
    assert decode(encode("/xinfo")) == ("/xinfo", [])
    with pytest.raises((ValueError, struct.error)):
        decode(b"/ch/01\0\0,f\0\0")


def test_hardware_meter_fixture():
    blob = struct.pack("<i4h", 4, -32768, -2560, -1536, 0)
    assert meters(blob) == [-128, -10, -6, 0]
    with pytest.raises(ValueError):
        meters(blob[:-1])


def test_validation_rejects_commands_outside_catalog_and_range():
    for host in ["8.8.8.8", "127.0.0.1", "192.168.2.255", "example.com"]:
        with pytest.raises(ValueError):
            validate_host(host)
    assert validate_host("192.168.2.141") == "192.168.2.141"
    for path, value in [
        ("/shutdown", 1),
        ("/ch/01/mix/fader", float("nan")),
        ("/ch/01/mix/on", 0.5),
        ("/ch/01/mix/fader", 1.1),
        ("/ch/01/config/name", "1234567890123"),
    ]:
        with pytest.raises(ValueError):
            validate_value(path, value)
    assert PARAMETERS["/ch/01/gate/mode"]["options"][0] == "Gate"
    assert PARAMETERS["/routing/aux/01/src"]["options"][38] == "U01"


def test_udp_session_roundtrip_readback_external_change_and_disconnect():
    async def scenario():
        writes = []
        value = 0.5

        class Desk(asyncio.DatagramProtocol):
            def connection_made(self, transport):
                self.transport = transport

            def datagram_received(self, data, addr):
                nonlocal value
                path, args = decode(data)
                if path == "/xinfo":
                    self.transport.sendto(
                        encode("/xinfo", "127.0.0.1", "Test", "XR18V2", "1.19"), addr
                    )
                elif path == "/ch/01/mix/fader":
                    if args:
                        writes.append(args[0])
                        value = args[0]
                    self.transport.sendto(encode(path, value), addr)

        loop = asyncio.get_running_loop()
        transport, _ = await loop.create_datagram_endpoint(Desk, local_addr=("127.0.0.1", 10024))
        mixer = MixerEngine()
        try:
            await mixer.configure("127.0.0.1")
            for _ in range(100):
                if "/ch/01/mix/fader" in mixer.values:
                    break
                await asyncio.sleep(0.02)
            assert mixer.connected
            assert not writes, "Connection and synchronization must never write to the desk"
            await mixer.write("/ch/01/mix/fader", 0.6)
            await asyncio.sleep(0.05)
            assert mixer.values["/ch/01/mix/fader"] == pytest.approx(0.6)
            assert not mixer.pending
            mixer.datagram_received(encode("/ch/01/mix/fader", 0.7), ("127.0.0.1", 10024))
            assert mixer.values["/ch/01/mix/fader"] == pytest.approx(0.7)
            mixer.last_seen = time.monotonic() - 6
            with pytest.raises(ValueError, match="offline"):
                await mixer.write("/ch/01/mix/fader", 0.8)
            assert len(writes) == 1
            # Spoofed sources and malformed/NaN packets never enter streamed state.
            mixer.datagram_received(encode("/ch/01/mix/fader", 0.2), ("127.0.0.2", 10024))
            mixer.datagram_received(encode("/ch/01/mix/fader", math.nan), ("127.0.0.1", 10024))
            mixer.datagram_received(b"/ch/01\0\0,f\0\0", ("127.0.0.1", 10024))
            assert mixer.values["/ch/01/mix/fader"] == pytest.approx(0.7)
        finally:
            await mixer.stop()
            transport.close()

    asyncio.run(scenario())


def test_fx_invalid_slots_ignored_and_integer_parameters_preserve_osc_type():
    async def scenario():
        mixer = MixerEngine()
        mixer.host = "192.168.2.141"
        addr = (mixer.host, 10024)
        mixer.datagram_received(encode("/fx/1/type", 7), addr)
        mixer.datagram_received(encode("/fx/1/par/13", 0), addr)
        mixer.datagram_received(encode("/fx/1/par/14", math.nan), addr)
        assert "/fx/1/par/14" not in mixer.values
        assert mixer.fx_specs["/fx/1/par/13"]["kind"] == "int"
        assert mixer.fx_specs["/fx/1/par/13"]["label"] == "Freeze"
        await asyncio.sleep(0)

    asyncio.run(scenario())


def test_mixer_endpoints_require_authentication():
    from fastapi.testclient import TestClient
    from app.main import create_app

    client = TestClient(create_app())
    for path in ["catalog", "state", "events", "snapshots"]:
        assert client.get("/api/v1/mixer/" + path).status_code == 401
    assert (
        client.post("/api/v1/mixer/command", json={"path": "/ch/01/mix/on", "value": 1}).status_code
        == 401
    )


def test_events_are_uncompressed_and_both_clients_receive_changes(monkeypatch):
    import json
    from types import SimpleNamespace
    from app.modules.mixer import routes

    class Desk:
        def __init__(self):
            self.values = {"/ch/01/mix/fader": 0.5}

        async def configure(self, host):
            assert host == "192.168.2.141"

        def snapshot(self):
            return {"host": "192.168.2.141", "values": self.values.copy(), "fx_specs": {}}

    desk = Desk()
    monkeypatch.setattr(routes, "engine", desk)
    monkeypatch.setattr(routes, "config", lambda session: SimpleNamespace(host="192.168.2.141"))

    async def scenario():
        session = SimpleNamespace(close=lambda: None)
        left = await routes.events(session)
        right = await routes.events(session)
        assert "no-transform" in left.headers["cache-control"]
        assert left.headers["content-encoding"] == "identity"
        assert left.headers["x-accel-buffering"] == "no"
        streams = [left.body_iterator, right.body_iterator]

        def data(frame):
            return json.loads(frame.removeprefix("data: ").strip())

        try:
            for stream in streams:
                assert data(await anext(stream))["reset"] is True
            desk.values["/ch/01/mix/fader"] = 0.8
            for stream in streams:
                update = data(await anext(stream))
                assert update["reset"] is False
                assert update["values"]["/ch/01/mix/fader"] == 0.8
                assert data(await anext(stream))["values"] == {}
        finally:
            for stream in streams:
                await stream.aclose()

    asyncio.run(scenario())


def test_command_batch_validates_before_any_hardware_writes(monkeypatch):
    from fastapi import HTTPException
    from app.modules.mixer import routes

    desk = MixerEngine()
    desk.host = "192.168.2.141"
    desk.identity = ["192.168.2.141", "Test", "XR18V2", "1.19"]
    desk.last_seen = time.monotonic()
    sent = []

    class Transport:
        def sendto(self, packet, address):
            sent.append(decode(packet))

    desk.transport = Transport()
    desk.values = {"/ch/01/mix/fader": 0.5, "/ch/01/mix/on": 1, "/headamp/01/phantom": 0}
    monkeypatch.setattr(routes, "engine", desk)

    async def scenario():
        with pytest.raises(HTTPException):
            await routes.commands(
                routes.Commands(
                    commands=[
                        routes.Command(path="/ch/01/mix/fader", value=0.8),
                        routes.Command(path="/headamp/01/phantom", value=1),
                    ]
                )
            )
        assert sent == []
        result = await routes.commands(
            routes.Commands(
                commands=[
                    routes.Command(path="/ch/01/mix/fader", value=0.8),
                    routes.Command(path="/ch/01/mix/on", value=0),
                ]
            )
        )
        assert result["paths"] == ["/ch/01/mix/fader", "/ch/01/mix/on"]
        assert sent[0] == ("/ch/01/mix/fader", [pytest.approx(0.8)])
        assert sent[2] == ("/ch/01/mix/on", [0])

    asyncio.run(scenario())


@pytest.mark.parametrize("loop_kind", ["asyncio", "uvloop"])
def test_discovery_roundtrip_on_default_and_production_event_loops(loop_kind):
    from app.modules.mixer.engine import discover

    async def scenario():
        probes = []

        class Desk(asyncio.DatagramProtocol):
            def connection_made(self, transport):
                self.transport = transport

            def datagram_received(self, data, addr):
                probes.append(decode(data))
                self.transport.sendto(b"invalid", addr)
                self.transport.sendto(encode("/xinfo", "127.0.0.1", "Other", "X32", "1"), addr)
                for _ in range(2):
                    self.transport.sendto(
                        encode("/xinfo", "127.0.0.1", "Church", "XR18V2", "1.19"), addr
                    )

        transport, _ = await asyncio.get_running_loop().create_datagram_endpoint(
            Desk, local_addr=("127.0.0.1", 10024)
        )
        try:
            assert await discover(["127.0.0.1"]) == [dict(
                host="127.0.0.1", name="Church", model="XR18V2", firmware="1.19"
            )]
            assert probes == [("/xinfo", [])]
        finally:
            transport.close()

    if loop_kind == "uvloop":
        pytest.importorskip("uvloop").run(scenario())
    else:
        asyncio.run(scenario())


def test_discovery_reports_network_setup_failure(monkeypatch):
    from fastapi import HTTPException
    from app.modules.mixer import routes

    async def unavailable(hosts):
        raise OSError("Network unavailable")

    monkeypatch.setattr(routes, "discover", unavailable)
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.discovery(routes.Discovery(subnet="192.168.1.0/24")))
    assert error.value.status_code == 503
    assert "server network" in error.value.detail


def test_missing_main_output_and_dca_readbacks_recover_without_writes(monkeypatch):
    from app.modules.mixer import engine as module

    paths = ["/lr/mix/fader", "/fxsend/1/mix/fader", "/dca/1/fader",
             "/headamp/07/gain", "/ch/01/mix/pan"]
    known = "/ch/01/mix/fader"
    optional = "/ch/01/eq/on"
    monkeypatch.setattr(module, "PARAMETERS", {
        path: PARAMETERS[path] for path in [*paths, known, optional]
    })
    monkeypatch.setattr(module, "FADER_READBACK_PATHS", (*paths, known))

    async def scenario():
        queries = {}
        writes = []

        class Desk(asyncio.DatagramProtocol):
            def connection_made(self, transport):
                self.transport = transport

            def datagram_received(self, data, addr):
                path, args = decode(data)
                if args and path in module.PARAMETERS:
                    writes.append((path, args))
                if path == "/xinfo":
                    self.transport.sendto(encode(path, "127.0.0.1", "Test", "XR18V2", "1.19"), addr)
                elif path in [*paths, known, optional]:
                    queries[path] = queries.get(path, 0) + 1
                    if path == known or path in paths and queries[path] > 1:
                        self.transport.sendto(encode(path, 0.75), addr)

        loop = asyncio.get_running_loop()
        transport, _ = await loop.create_datagram_endpoint(Desk, local_addr=("127.0.0.1", 10024))
        mixer = MixerEngine()
        try:
            await mixer.configure("127.0.0.1")
            for _ in range(100):
                if mixer.synchronized:
                    break
                await asyncio.sleep(0.02)
            assert mixer.synchronized
            assert all(path not in mixer.values for path in paths)
            for _ in range(250):
                if all(path in mixer.values for path in paths):
                    break
                await asyncio.sleep(0.02)
            assert all(mixer.values.get(path) == pytest.approx(0.75) for path in paths)
            assert queries[known] == 1, "Confirmed controls must not be polled again"
            assert queries[optional] == 1, "Unsupported DSP values must not be retried"
            assert not writes, "Readback recovery must never move a fader"
        finally:
            await mixer.stop()
            transport.close()
        assert mixer.readback_task is None

    asyncio.run(scenario())


def test_readback_recovery_covers_faders_mutes_and_sends():
    from app.modules.mixer.catalog import STRIPS
    from app.modules.mixer.engine import FADER_READBACK_PATHS

    assert FADER_READBACK_PATHS[0] == "/lr/mix/fader"
    for strip in STRIPS:
        root = strip["id"] if strip["kind"] == "dca" else strip["id"] + "/mix"
        assert root + "/fader" in FADER_READBACK_PATHS
        assert root + "/on" in FADER_READBACK_PATHS
    assert "/ch/01/mix/01/level" in FADER_READBACK_PATHS


def test_startup_mute_requires_all_readbacks_and_does_not_repeat_after_release():
    from app.modules.mixer.engine import STARTUP_MUTE_PATHS

    async def scenario():
        sent = []
        class Transport:
            def sendto(self, packet, address):
                sent.append(decode(packet))
        mixer = MixerEngine()
        mixer.host = "192.168.4.106"
        mixer.transport = Transport()
        mixer.identity = ["ip", "desk", "XR18V2", "1.19"]
        mixer.last_seen = time.monotonic()
        mixer.arm_startup_mute()
        assert len(STARTUP_MUTE_PATHS) == 21
        assert mixer.startup_muting
        await mixer.apply_startup_mute()
        assert len(sent) == 21
        assert all(not args for path, args in sent), "Missing values must be queried first"
        mixer.values = dict.fromkeys(STARTUP_MUTE_PATHS, 1)
        with pytest.raises(ValueError, match="Startup mute"):
            await mixer.write("/ch/01/mix/on", 1)
        await mixer.apply_startup_mute()
        writes = [(path, args) for path, args in sent if args]
        assert len(writes) == 21
        assert all(path in STARTUP_MUTE_PATHS and args == [0] for path, args in writes)
        assert mixer.startup_muting, "Sending is not hardware confirmation"
        for path in STARTUP_MUTE_PATHS[:-1]:
            mixer.datagram_received(encode(path, 0), (mixer.host, 10024))
        assert mixer.startup_muting
        mixer.datagram_received(encode(STARTUP_MUTE_PATHS[-1], 0), (mixer.host, 10024))
        assert not mixer.startup_muting
        assert not mixer.pending
        await mixer.write("/ch/01/mix/on", 1)
        mixer.datagram_received(encode("/ch/01/mix/on", 1), (mixer.host, 10024))
        sent.clear()
        await mixer.apply_startup_mute()
        assert not sent
        assert mixer.values["/ch/01/mix/on"] == 1
    asyncio.run(scenario())
