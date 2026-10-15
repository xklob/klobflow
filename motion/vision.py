"""Learned point tracking. No brightness, LED colour, or staff-length detector.

The model follows two user-selected ends. Its estimates and visibility are kept
separate: a hidden end is still a hypothesis, never a new camera observation.
"""

from __future__ import annotations

from pathlib import Path
import time

import cv2
import numpy as np
import torch


def seed_points(seed):
    points = np.asarray(seed, dtype=np.float32)
    if points.shape != (2, 2) or not np.isfinite(points).all() or (points < 0).any() or (points > 1).any():
        raise ValueError("Select two points within the image")
    if np.linalg.norm(points[0] - points[1]) < 1e-6:
        raise ValueError("Select distinct staff ends")
    return points


def observation(name, positions, visibility, timestamp, elapsed, deviations=None, reliability=None):
    if not np.isfinite(positions).all() or not np.isfinite(visibility).all():
        raise RuntimeError("The model returned an invalid estimate; select the staff again")
    ends = []
    for i, (xy, probability) in enumerate(zip(positions, visibility)):
        in_view = bool((xy >= 0).all() and (xy <= 1).all())
        confidence = probability if reliability is None else reliability[i]
        ends.append({
            "id": "ab"[i], "x": float(xy[0]), "y": float(xy[1]),
            "visibility": float(probability), "confidence": float(confidence),
            "spread": None if deviations is None else {"x": float(deviations[i, 0]), "y": float(deviations[i, 1])},
            "state": "visible" if in_view and confidence >= .5 else "inferred",
        })
    midpoint = positions.mean(0)
    return {"time": timestamp, "model": name, "inferenceMs": elapsed, "ends": ends,
            "midpoint": {"x": float(midpoint[0]), "y": float(midpoint[1]),
                         "state": "visible" if all(e["state"] == "visible" for e in ends) else "inferred"}}


class PointTracker:
    name = "TAPNext++"

    def __init__(self, checkpoint: str | Path, device: str | None = None):
        from tapnet.tapnext.tapnext_torch import TAPNext

        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.model = TAPNext(image_size=(256, 256))
        saved = torch.load(checkpoint, map_location="cpu", weights_only=True, mmap=True)
        weights = saved.get("state_dict", saved)
        weights = {k.removeprefix("tapnext."): v for k, v in weights.items()}
        self.model.load_state_dict(weights)
        self.model.to(self.device).eval()
        if self.device.type == "cuda":
            self.model.half()
        self.reset()

    def reset(self):
        self.state = None
        self.last_time = None

    @torch.inference_mode()
    def track(self, bgr: np.ndarray, timestamp: float, seed=None) -> dict:
        if not np.isfinite(timestamp):
            raise ValueError("A finite frame timestamp is required")
        if seed is None and self.state is None:
            raise ValueError("Select the two staff ends first")
        if seed is None and self.last_time is not None and timestamp <= self.last_time:
            raise ValueError("Frames must arrive in timestamp order")
        queries = None
        if seed is not None:
            points = seed_points(seed)
            self.reset()
            # Model uses [frame, y, x] queries in its 256-square coordinates.
            queries = torch.as_tensor(
                np.c_[np.zeros(2), points[:, ::-1] * 256][None],
                dtype=torch.float32, device=self.device,
            )
        rgb = cv2.cvtColor(cv2.resize(bgr, (256, 256), interpolation=cv2.INTER_LINEAR), cv2.COLOR_BGR2RGB)
        video = torch.from_numpy(rgb.copy()).to(self.device).float().div_(127.5).sub_(1)[None, None]
        started = time.perf_counter()
        with torch.autocast(self.device.type, dtype=torch.float16, enabled=self.device.type == "cuda"):
            tracks, logits, visibility, self.state = self.model(video=video, query_points=queries, state=self.state)
        positions = tracks[0, 0].float().cpu().numpy()[:, ::-1] / 256
        visible = visibility[0, 0, :, 0].float().sigmoid().cpu().numpy()
        distributions = logits[0, 0].float().reshape(2, 2, 256).softmax(-1).cpu().numpy()
        coordinates = (np.arange(256) + .5) / 256
        means = (distributions * coordinates).sum(-1)
        deviations = np.sqrt((distributions * (coordinates - means[..., None]) ** 2).sum(-1))[:, ::-1]
        elapsed = (time.perf_counter() - started) * 1000
        self.last_time = timestamp
        return observation(self.name, positions, visible, timestamp, elapsed, deviations)


class TapirTracker:
    """Official causal BootsTAPIR API, with learned visibility and uncertainty."""
    name = "BootsTAPIR"

    def __init__(self, checkpoint: str | Path, device: str | None = None):
        from tapnet.torch.tapir_model import TAPIR
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.model = TAPIR(pyramid_level=1, use_casual_conv=True)
        self.model.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True))
        self.model.to(self.device).eval()
        self.reset()

    def reset(self):
        self.features = None
        self.state = None
        self.last_time = None

    @torch.inference_mode()
    def track(self, bgr: np.ndarray, timestamp: float, seed=None) -> dict:
        import tree
        if not np.isfinite(timestamp):
            raise ValueError("A finite frame timestamp is required")
        if seed is None and self.features is None:
            raise ValueError("Select the two staff ends first")
        if seed is None and self.last_time is not None and timestamp <= self.last_time:
            raise ValueError("Frames must arrive in timestamp order")
        rgb = cv2.cvtColor(cv2.resize(bgr, (256, 256)), cv2.COLOR_BGR2RGB)
        video = torch.from_numpy(rgb.copy()).to(self.device).float().div_(127.5).sub_(1)[None, None]
        started = time.perf_counter()
        grids = self.model.get_feature_grids(video, is_training=False)
        if seed is not None:
            points = seed_points(seed)
            self.reset()
            queries = torch.as_tensor(np.c_[np.zeros(2), points[:, ::-1] * 256][None], dtype=torch.float32, device=self.device)
            self.features = self.model.get_query_features(video, is_training=False, query_points=queries, feature_grids=grids)
            self.state = self.model.construct_initial_causal_state(2, len(self.features.resolutions) - 1)
            self.state = tree.map_structure(lambda value: value.to(self.device), self.state)
        output = self.model.estimate_trajectories(
            video.shape[-3:-1], is_training=False, feature_grids=grids,
            query_features=self.features, query_points_in_video=None,
            query_chunk_size=2, causal_context=self.state, get_causal_context=True,
        )
        self.state = output["causal_context"]
        positions = output["tracks"][-1][0, :, 0].cpu().numpy() / 256
        visibility = (1 - output["occlusion"][-1][0, :, 0].sigmoid()).cpu().numpy()
        reliability = visibility * (1 - output["expected_dist"][-1][0, :, 0].sigmoid()).cpu().numpy()
        elapsed = (time.perf_counter() - started) * 1000
        self.last_time = timestamp
        return observation(self.name, positions, visibility, timestamp, elapsed, reliability=reliability)
