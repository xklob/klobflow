"""Build tip/boundary examples from manually labeled, private recordings.

A hidden end has no position label. It can label a distant segmentation
boundary as non-tip, but never supplies an invented hidden-tip coordinate.
Ambiguous frames contribute visible positives only; their other boundary is
excluded. Every crop/augmentation inherits its source recording's group.
"""
from dataclasses import dataclass
import json
from pathlib import Path

import cv2
import numpy as np


@dataclass
class Example:
    clip: str
    frame: int
    candidate: int
    point: np.ndarray
    inward: np.ndarray
    length: float
    label: int
    kind: str
    uncertainty: float


def examples_from_labels(labels, replays):
    width, height = labels["width"], labels["height"]
    examples, skipped = [], []
    for frame in labels["frames"]:
        clip, index = frame["clip"], frame["index"]
        result = replays.get(clip, {}).get(index)
        if result is None or result.get("visibleExtent") is None:
            skipped.append({"clip": clip, "frame": index, "reason": "no replay boundary"})
            continue
        observed = np.asarray(result["visibleExtent"], float) * [width, height]
        delta = observed[1] - observed[0]
        span = np.linalg.norm(delta)
        if not np.isfinite(observed).all() or span < 1:
            skipped.append({"clip": clip, "frame": index, "reason": "degenerate boundary"})
            continue
        ends = np.array([[e["x"] * width, e["y"] * height] for e in result["ends"]])
        length = max(span, float(np.linalg.norm(ends[1] - ends[0])))
        direction = delta / span
        visible = [e for e in frame["ends"] if e["visibility"] == "visible" and e["point"] is not None]
        ambiguous = any(e["visibility"] == "ambiguous" for e in frame["ends"])
        for candidate, point in enumerate(observed):
            distances = [np.linalg.norm(point - e["point"]) for e in visible]
            nearest = int(np.argmin(distances)) if distances else None
            if nearest is not None and distances[nearest] <= 2 * visible[nearest]["uncertainty_px"]:
                label, uncertainty = 1, visible[nearest]["uncertainty_px"]
            elif not ambiguous and (nearest is None or distances[nearest] > 3 * visible[nearest]["uncertainty_px"]):
                label, uncertainty = 0, 2.
            else:
                skipped.append({"clip": clip, "frame": index, "candidate": candidate, "reason": "uncertain boundary label"})
                continue
            examples.append(Example(clip, index, candidate, point, direction * (1 if candidate == 0 else -1),
                                    length, label, "boundary", float(uncertainty)))
        # Ground-truth-centered positive crops add position variation during
        # training. They are never mixed into the boundary evaluation metric.
        for i, end in enumerate(visible):
            point = np.asarray(end["point"], float)
            side = int(np.argmin(np.linalg.norm(observed - point, axis=1)))
            examples.append(Example(clip, index, side, point, direction * (1 if side == 0 else -1),
                                    length, 1, "annotation", float(end["uncertainty_px"])))
    return examples, skipped


def load_sources(manifest_path):
    manifest = json.loads(Path(manifest_path).read_text())
    labels_path = Path(manifest["labels"])
    labels = json.loads(labels_path.read_text())
    # A second alias for the same recording is not an independent holdout.
    for field in ("video", "cache"):
        identities = [str(Path(labels["clips"][clip][field]).resolve()) for clip in manifest["replays"]]
        if len(identities) != len(set(identities)):
            raise ValueError(f"Duplicate recording {field}: aliases cannot form separate folds")
    replays = {}
    for clip, path in manifest["replays"].items():
        replay = json.loads(Path(path).read_text())
        if not replay["summary"].get("complete"):
            raise ValueError(f"Incomplete replay: {clip}")
        replays[clip] = {f["index"]: f for f in replay["frames"]}
    examples, skipped = examples_from_labels(labels, replays)
    frames = {clip: np.memmap(data["cache"], mode="r", dtype=np.uint8).reshape(-1, labels["height"], labels["width"], 4)
              for clip, data in labels["clips"].items() if clip in replays}
    for example in examples:
        if example.frame >= len(frames[example.clip]):
            raise ValueError("Annotation frame is beyond the reference decode")
    return manifest, examples, skipped, frames


def aligned_crop(image, point, inward, length, size=224, scale=.45):
    """Align a candidate to the centre; the staff points downward in the crop."""
    point, inward = np.asarray(point, float), np.asarray(inward, float)
    norm = float(np.linalg.norm(inward))
    if not np.isfinite([*point, *inward, length, scale]).all() or norm <= 0 or length <= 0 or scale <= 0:
        raise ValueError("Invalid crop geometry")
    inward = inward / norm
    right = np.array([inward[1], -inward[0]])
    step = length * scale / size
    axes = np.column_stack((right, inward)) * step
    transform = np.column_stack((axes, point - axes @ np.array([(size-1)/2, (size-1)/2])))
    return cv2.warpAffine(image, transform, (size, size), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))


def assert_disjoint(train_groups, test_groups):
    overlap = set(train_groups) & set(test_groups)
    if overlap:
        raise ValueError(f"Recording leakage: {sorted(overlap)}")
    if not train_groups or not test_groups:
        raise ValueError("Both training and evaluation recordings are required")
