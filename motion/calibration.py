"""OpenCV calibration primitives, separate from tracking and camera mirroring.

Correction order is lens -> practice plane -> display mirror. A background
plane is only a reference parallel to the movement plane, not recovered depth.
"""

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class LensProfile:
    width: int
    height: int
    matrix: np.ndarray
    distortion: np.ndarray
    model: str = "pinhole"

    @classmethod
    def parse(cls, data):
        width, height = int(data["width"]), int(data["height"])
        matrix = np.asarray(data["matrix"], dtype=np.float64)
        distortion = np.asarray(data["distortion"], dtype=np.float64).reshape(-1)
        model = data.get("model", "pinhole")
        if not (1 <= width <= 16384 and 1 <= height <= 16384):
            raise ValueError("Invalid calibration image size")
        if matrix.shape != (3, 3) or not np.isfinite(matrix).all() or not np.isfinite(distortion).all():
            raise ValueError("Invalid lens profile")
        if matrix[0, 0] <= 0 or matrix[1, 1] <= 0 or not np.allclose(matrix[2], [0, 0, 1]):
            raise ValueError("Invalid camera matrix")
        if model not in ("pinhole", "fisheye") or len(distortion) not in ((4,) if model == "fisheye" else (4, 5, 8, 12, 14)):
            raise ValueError("Unsupported lens model")
        return cls(width, height, matrix, distortion, model)

    def camera_matrix(self, width, height):
        if abs(width / height - self.width / self.height) > .001:
            raise ValueError("This profile has a different image aspect ratio. Recalibrate for this camera mode.")
        matrix = self.matrix.copy()
        matrix[0] *= width / self.width
        matrix[1] *= height / self.height
        return matrix

    def maps(self, width, height):
        matrix = self.camera_matrix(width, height)
        if self.model == "fisheye":
            return cv2.fisheye.initUndistortRectifyMap(matrix, self.distortion, np.eye(3), matrix, (width, height), cv2.CV_32FC1)
        return cv2.initUndistortRectifyMap(matrix, self.distortion, None, matrix, (width, height), cv2.CV_32FC1)

    def json(self):
        return {"width": self.width, "height": self.height, "matrix": self.matrix.tolist(),
                "distortion": self.distortion.tolist(), "model": self.model}


def plane_transform(corners, width, height, aspect=1.0):
    """Four corners in TL, TR, BR, BL order, from the lens-corrected image."""
    points = np.asarray(corners, dtype=np.float32)
    if points.shape != (4, 2) or not np.isfinite(points).all() or (points < 0).any() or (points > 1).any():
        raise ValueError("Choose four corners within the corrected image")
    if not np.isfinite(aspect) or not .1 <= aspect <= 10:
        raise ValueError("Enter a width-to-height ratio between 0.1 and 10")
    pixel_points = points * [width, height]
    if not cv2.isContourConvex(pixel_points.astype(np.float32)) or abs(cv2.contourArea(pixel_points.astype(np.float32))) < width * height * .005:
        raise ValueError("Choose four distinct corners around a rectangle, in order")
    # Preserve space around the reference. Do not crop the view to the tapestry.
    center = pixel_points.mean(0)
    side = np.sqrt(abs(cv2.contourArea(pixel_points.astype(np.float32))) / aspect)
    target = np.array([[-aspect, -1], [aspect, -1], [aspect, 1], [-aspect, 1]], dtype=np.float32) * (side / 2) + center
    return cv2.getPerspectiveTransform(pixel_points.astype(np.float32), target.astype(np.float32))


class Geometry:
    def __init__(self):
        self.lens = None
        self.corners = None
        self.aspect = 1.0
        self._cache = None

    def configure(self, lens=None, corners=None, aspect=1.0):
        profile = LensProfile.parse(lens) if lens is not None else None
        if corners is not None:
            plane_transform(corners, 1000, 1000, aspect)
        self.lens, self.corners, self.aspect = profile, corners, aspect
        self._cache = None

    def apply(self, image):
        height, width = image.shape[:2]
        if self._cache is None or self._cache[0] != (width, height):
            maps = self.lens.maps(width, height) if self.lens else None
            matrix = plane_transform(self.corners, width, height, self.aspect) if self.corners else None
            self._cache = (width, height), maps, matrix
        _, maps, matrix = self._cache
        if maps is not None:
            image = cv2.remap(image, maps[0], maps[1], cv2.INTER_LINEAR)
        if matrix is not None:
            image = cv2.warpPerspective(image, matrix, (width, height))
        return image


def calibrate_checkerboard(images, columns=9, rows=6, model="pinhole"):
    """Multiple board poses identify intrinsics; return measured reprojection error."""
    if not 3 <= columns <= 20 or not 3 <= rows <= 20 or model not in ("pinhole", "fisheye"):
        raise ValueError("Invalid checkerboard settings")
    if len(images) < 8:
        raise ValueError("Capture at least eight checkerboard views at different positions and tilts")
    object_points, image_points = [], []
    size = images[0].shape[1], images[0].shape[0]
    board = np.zeros((rows * columns, 3), dtype=np.float64)
    board[:, :2] = np.mgrid[0:columns, 0:rows].T.reshape(-1, 2)
    for image in images:
        if (image.shape[1], image.shape[0]) != size:
            raise ValueError("Keep the same camera resolution for every calibration view")
        found, corners = cv2.findChessboardCornersSB(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (columns, rows))
        if found:
            # Repeated clicks on a stationary board do not supply independent
            # views. Compare both detector orders because the board is symmetric.
            if any(min(np.sqrt(np.mean((corners-other)**2)),
                       np.sqrt(np.mean((corners-other[::-1])**2))) < 2.
                   for other in image_points):
                continue
            object_points.append(board.copy())
            image_points.append(corners)
    if len(image_points) < 8:
        raise ValueError(f"The checkerboard was found in {len(image_points)} distinct views; eight are required. Move and tilt the board between captures.")
    if model == "fisheye":
        rms, matrix, distortion, rotations, translations = cv2.fisheye.calibrate(
            [p.reshape(1, -1, 3) for p in object_points],
            [p.astype(np.float64).reshape(1, -1, 2) for p in image_points], size, None, None,
            flags=cv2.fisheye.CALIB_RECOMPUTE_EXTRINSIC | cv2.fisheye.CALIB_FIX_SKEW | cv2.fisheye.CALIB_CHECK_COND,
        )
    else:
        rms, matrix, distortion, rotations, translations = cv2.calibrateCamera(
            [p.astype(np.float32) for p in object_points], image_points, size, None, None,
        )
    if not np.isfinite(rms):
        raise ValueError("The calibration could not be solved. Capture more varied board positions and tilts.")
    profile = LensProfile.parse({"width": size[0], "height": size[1], "matrix": matrix.tolist(),
                                "distortion": distortion.flatten().tolist(), "model": model})
    return {"profile": profile.json(), "rmsPixels": float(rms), "views": len(image_points)}
