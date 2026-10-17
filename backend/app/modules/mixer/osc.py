"""Small, strict OSC codec (XR18 uses big-endian OSC, little-endian meter blobs)."""

import struct


def string(value: str) -> bytes:
    data = value.encode("utf-8") + b"\0"
    return data + b"\0" * (-len(data) % 4)


def encode(path: str, *args) -> bytes:
    tags, payload = ",", b""
    for value in args:
        if isinstance(value, str):
            tags += "s"
            payload += string(value)
        elif isinstance(value, int):
            tags += "i"
            payload += struct.pack(">i", value)
        else:
            tags += "f"
            payload += struct.pack(">f", value)
    return string(path) + (string(tags) + payload if args else b"")


def decode(data: bytes) -> tuple[str, list]:
    def read_string(offset):
        end = data.index(b"\0", offset)
        return data[offset:end].decode("utf-8"), (end + 4) & ~3

    path, offset = read_string(0)
    if offset >= len(data):
        return path, []
    tags, offset = read_string(offset)
    if not tags.startswith(","):
        raise ValueError("Invalid OSC type tag")
    values = []
    for tag in tags[1:]:
        if tag == "s":
            value, offset = read_string(offset)
        elif tag in ("i", "f"):
            value = struct.unpack_from(">" + tag, data, offset)[0]
            offset += 4
        elif tag == "b":
            size = struct.unpack_from(">i", data, offset)[0]
            offset += 4
            if size < 0 or offset + size > len(data):
                raise ValueError("Truncated OSC blob")
            value = data[offset : offset + size]
            offset += (size + 3) & ~3
        else:
            raise ValueError("Unsupported OSC type")
        values.append(value)
    return path, values


def meters(blob: bytes) -> list[float]:
    count = struct.unpack_from("<i", blob)[0]
    if count < 0 or count > 256 or len(blob) != 4 + count * 2:
        raise ValueError("Invalid XR18 meter block")
    # X AIR fixed point meters: 256 counts per dB; -32768 denotes silence.
    return [max(-128.0, n / 256.0) for n in struct.unpack_from("<" + "h" * count, blob, 4)]
