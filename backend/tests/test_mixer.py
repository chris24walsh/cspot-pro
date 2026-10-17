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
