import json
import struct

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from motion.calibration import Geometry, LensProfile, plane_transform
from motion.protocol import decode, encode
from motion.server import Runtime, create_app, private_address


class FakeTracker:
    name = "Test fixture"
    device = "cpu"
    def reset(self):
        self.seed = None
    def track(self, frame, timestamp, seed=None):
        if seed is not None:
            self.seed = seed
        if self.seed is None:
            raise ValueError("Select the two staff ends first")
        return {"time": timestamp, "inferenceMs": 12, "ends": [
            {"id": "ab"[i], "x": p[0], "y": p[1], "state": "visible", "visibility": .9, "confidence": .9}
            for i, p in enumerate(self.seed)],
            "midpoint": {"x": float(np.mean(self.seed, axis=0)[0]), "y": float(np.mean(self.seed, axis=0)[1]), "state": "visible"}}


def fake_runtime():
    runtime = Runtime()
    runtime.tracker = FakeTracker()
    runtime.tracker.reset()
    return runtime


def sample_packet(id=1, **metadata):
    image = np.zeros((120, 200, 3), dtype=np.uint8)
    cv2.line(image, (30, 60), (170, 60), (230, 230, 230), 5)
    _, jpeg = cv2.imencode(".jpg", image)
    return encode({"id": id, "time": id / 60, **metadata}, jpeg.tobytes())


def test_packet_bounds_and_exact_roundtrip():
    packet = sample_packet()
    metadata, jpeg = decode(packet)
    assert metadata == {"id": 1, "time": 1 / 60}
    assert cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR).shape == (120, 200, 3)
    for bad in (b"", packet[:-1], packet + b"extra", struct.pack(">II", 2**31, 20), struct.pack(">II", 0, 0)):
        with pytest.raises(ValueError):
            decode(bad)


@pytest.mark.parametrize("bad", ["example.com", "8.8.8.8", "169.254.169.254", "192.168.1.1:0", "192.168.1.1:65536", "127.0.0.2", "192.168.1.1/path"])
def test_phone_bridge_rejects_external_or_invalid_hosts(bad):
    with pytest.raises(ValueError):
        private_address(bad)


def test_phone_addresses():
    assert private_address("192.168.1.20") == "192.168.1.20:8787"
    assert private_address("127.0.0.1:9000") == "127.0.0.1:9000"


def test_plane_maps_slanted_square_without_changing_camera_center_arbitrarily():
    corners = [[.3, .2], [.7, .3], [.8, .8], [.2, .7]]
    matrix = plane_transform(corners, 1000, 600)
    output = cv2.perspectiveTransform(np.array(corners, dtype=np.float32).reshape(-1, 1, 2) * [1000, 600], matrix).reshape(-1, 2)
    assert output[0, 1] == pytest.approx(output[1, 1], abs=.01)
    assert output[2, 1] == pytest.approx(output[3, 1], abs=.01)
    assert output[0, 0] == pytest.approx(output[3, 0], abs=.01)
    assert np.linalg.norm(output[0] - output[1]) == pytest.approx(np.linalg.norm(output[1] - output[2]), abs=.01)


@pytest.mark.parametrize("corners", [ [[.1,.1],[.9,.9],[.9,.1],[.1,.9]], [[.1,.1]]*4, [[0,0],[.1,.1],[.2,.2],[.3,.3]] ])
def test_degenerate_planes_are_rejected(corners):
    with pytest.raises(ValueError):
        plane_transform(corners, 1000, 600)


def test_lens_profile_scaling_and_mode_guard():
    profile = LensProfile.parse({"width": 1000, "height": 600, "matrix": [[600,0,500],[0,600,300],[0,0,1]], "distortion": [0,0,0,0,0]})
    assert np.allclose(profile.camera_matrix(500,300), [[300,0,250],[0,300,150],[0,0,1]])
    with pytest.raises(ValueError, match="aspect ratio"):
        profile.camera_matrix(640,480)
    image = np.random.default_rng(1).integers(0,255,(300,500,3),dtype=np.uint8)
    geometry = Geometry();geometry.configure(profile.json())
    assert np.array_equal(geometry.apply(image), image)


def test_websocket_preserves_frame_identity_and_requires_reselection_after_geometry():
    runtime = fake_runtime()
    with TestClient(create_app(runtime, preload=False), base_url="http://localhost") as client:
        with client.websocket_connect("ws://localhost/ws/track", headers={"origin":"http://localhost"}) as ws:
            assert ws.receive_json()["type"] == "ready"
            ws.send_bytes(sample_packet(seed=[[.15,.5],[.85,.5]]))
            metadata, image = decode(ws.receive_bytes())
            assert metadata["id"] == 1 and metadata["ends"][0]["x"] == .15
            ws.send_json({"type":"geometry","corners":None})
            assert ws.receive_json()["type"] == "geometry"
            ws.send_bytes(sample_packet(2))
            assert "Select" in ws.receive_json()["error"]
            ws.send_bytes(sample_packet(3, previewOnly=True))
            metadata, image = decode(ws.receive_bytes())
            assert metadata["id"] == 3 and metadata["ends"] == []
        assert runtime.owner is None


def test_local_origin_guard_and_single_tracker_ownership():
    with TestClient(create_app(fake_runtime(), preload=False), base_url="http://localhost") as client:
        assert client.get("/api/status").status_code == 200
        assert client.get("/api/status", headers={"origin":"https://attacker.invalid"}).status_code == 403
        with client.websocket_connect("ws://localhost/ws/track") as first:
            assert first.receive_json()["type"] == "ready"
            with client.websocket_connect("ws://localhost/ws/track") as second:
                assert "another tab" in second.receive_json()["error"]
            first.send_bytes(b"bad packet")
            assert first.receive_json()["type"] == "error"
            first.send_bytes(sample_packet(previewOnly=True))
            assert decode(first.receive_bytes())[0]["id"] == 1


def test_calibration_recovers_known_lens_and_rejects_duplicate_views(monkeypatch):
    from motion.calibration import calibrate_checkerboard
    board=np.zeros((54,3),np.float64)
    board[:,:2]=np.mgrid[0:9,0:6].T.reshape(-1,2)
    matrix=np.array([[710.,0,400.],[0,705.,300.],[0,0,1.]])
    distortion=np.array([-.18,.04,0.001,-.001,0.])
    corners=[]
    for i in range(12):
        rotation=np.array([-.32+.06*i,.27*np.sin(i),.12*np.cos(i)])
        translation=np.array([-4.+np.sin(i),-2.5+np.cos(i),12.+i*.35])
        points,_=cv2.projectPoints(board,rotation,translation,matrix,distortion)
        corners.append(points.astype(np.float32))
    supplied=iter(corners)
    monkeypatch.setattr(cv2,'findChessboardCornersSB',lambda *args:(True,next(supplied)))
    images=[np.zeros((600,800,3),np.uint8)]*12
    result=calibrate_checkerboard(images)
    assert np.allclose(result['profile']['matrix'],matrix,atol=.1)
    assert np.allclose(result['profile']['distortion'],distortion,atol=.001)
    assert result['rmsPixels']<.01
    monkeypatch.setattr(cv2,'findChessboardCornersSB',lambda *args:(True,corners[0]))
    with pytest.raises(ValueError,match='distinct views'):
        calibrate_checkerboard(images)


def test_bad_frame_headers_and_non_object_commands_do_not_break_connection():
    with TestClient(create_app(fake_runtime(),preload=False),base_url='http://localhost') as client:
        with client.websocket_connect('ws://localhost/ws/track') as ws:
            ws.receive_json()
            ws.send_json([])
            assert ws.receive_json()['type']=='error'
            ws.send_bytes(encode({'id':1,'time':1.},b'not jpeg'))
            assert ws.receive_json()['type']=='error'
            ws.send_bytes(sample_packet(previewOnly=True))
            assert decode(ws.receive_bytes())[0]['id']==1
