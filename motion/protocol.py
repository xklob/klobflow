"""Bounded camera packets shared by browser, phone relay, and model worker."""

import json
import struct

MAX_META = 131072
MAX_IMAGE = 4 * 1024 * 1024


def encode(metadata, jpeg=b""):
    payload = json.dumps(metadata, allow_nan=False, separators=(",", ":")).encode()
    if len(payload) > MAX_META or len(jpeg) > MAX_IMAGE:
        raise ValueError("Frame is too large")
    return struct.pack(">II", len(payload), len(jpeg)) + payload + jpeg


def decode(packet):
    if len(packet) < 8:
        raise ValueError("Incomplete frame")
    meta_size, image_size = struct.unpack(">II", packet[:8])
    if not 0 < meta_size <= MAX_META or not 0 < image_size <= MAX_IMAGE:
        raise ValueError("Invalid frame size")
    if len(packet) != 8 + meta_size + image_size:
        raise ValueError("Incomplete frame")
    metadata = json.loads(packet[8:8 + meta_size])
    if not isinstance(metadata, dict):
        raise ValueError("Frame metadata must be an object")
    return metadata, packet[8 + meta_size:]
