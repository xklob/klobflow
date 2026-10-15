"""Describe a learned object mask using OpenCV geometry and motion filtering.

The initial selection supplies a length prior. A short visible fragment does
not redefine the staff as a shorter object. Inferred ends remain explicitly
inferred. There is no target location, LED colour, or brightness threshold.
"""
from collections import deque
import math

import cv2
import numpy as np


class StaffShape:
    def __init__(self, seed, width, height, model_size=512):
        points = np.asarray(seed, dtype=np.float64) * [width, height]
        delta = points[1] - points[0]
        self.lengths = deque([float(np.linalg.norm(delta))], maxlen=120)
        self.width, self.height = width, height
        self.pixel = max(width, height) / model_size
        center = points.mean(0)
        self.filter = cv2.KalmanFilter(6, 3, 0, cv2.CV_64F)
        self.filter.statePost = np.array([center[0], center[1], math.atan2(delta[1], delta[0]), 0., 0., 0.]).reshape(-1, 1)
        self.filter.measurementMatrix = np.c_[np.eye(3), np.zeros((3, 3))]
        self.filter.errorCovPost = np.diag([self.pixel**2, self.pixel**2, (self.pixel/self.lengths[0])**2, self.lengths[0]**2, self.lengths[0]**2, math.pi**2])
        self.last_time = None
        self.last_seen = None
        self.accelerations = deque(maxlen=120)
        self.previous_velocity = np.zeros(3)

    def update(self, mask, timestamp, presence=1.):
        dt = 0. if self.last_time is None else timestamp - self.last_time
        if dt < 0 or not math.isfinite(timestamp):
            raise ValueError("Frames must arrive in timestamp order")
        self.last_time = timestamp
        transition = np.eye(6)
        transition[:3, 3:] = np.eye(3) * dt
        self.filter.transitionMatrix = transition
        length = float(np.median(self.lengths))
        if len(self.accelerations) > 1:
            acceleration = np.maximum(np.var(self.accelerations, axis=0), [self.pixel**2, self.pixel**2, (self.pixel/length)**2])
        else:
            acceleration = np.array([length**2, length**2, math.pi**2])
        gain = np.r_[np.eye(3) * dt**2 / 2, np.eye(3) * dt]
        self.filter.processNoiseCov = gain @ np.diag(acceleration) @ gain.T
        predicted = self.filter.predict().flatten()
        center = predicted[:2]
        theta = predicted[2]
        axis = np.array([math.cos(theta), math.sin(theta)])
        positions = np.array([center-axis*length/2, center+axis*length/2])
        visible = [False, False]
        observed = None
        points = cv2.findNonZero(mask.astype(np.uint8))
        if points is not None and len(points) >= 2:
            points = points.reshape(-1, 2).astype(np.float64)
            vx, vy, cx, cy = cv2.fitLine(points, cv2.DIST_HUBER, 0, .01, .01).flatten()
            measured_axis = np.array([vx, vy])
            if measured_axis @ axis < 0:
                measured_axis *= -1
            measured_center = np.array([cx, cy])
            along = (points-measured_center) @ measured_axis
            across = (points-measured_center) @ np.array([-measured_axis[1], measured_axis[0]])
            noise = max(self.pixel, float(np.std(across)))
            observed = np.array([measured_center+measured_axis*along.min(), measured_center+measured_axis*along.max()])
            span = float(along.max()-along.min())
            if span > 0:
                # A statistical interval from measured mask width and learned
                # lengths, rather than a hand-set minimum length or colour rule.
                length_sigma = math.sqrt(float(np.var(self.lengths)) + 2*noise**2)
                # Occlusion can shorten the visible span. A longer supported
                # span can instead be perspective, scale, or a better view of
                # the same staff; never truncate it to the initial selection.
                complete = span >= length - 3*length_sigma
                if complete:
                    visible = [True, True]
                    self.lengths.append(span)
                    length = float(np.median(self.lengths))
                    target_center = observed.mean(0)
                    positions = observed
                else:
                    # The nearer of the two outer boundaries anchors a partial
                    # shape. Its opposite end is a rigid-length hypothesis.
                    distances = np.linalg.norm(observed-positions, axis=1)
                    anchor = int(np.argmin(distances))
                    visible[anchor] = True
                    sign = -1 if anchor == 0 else 1
                    target_center = observed[anchor] - sign*measured_axis*length/2
                    positions = np.array([target_center-measured_axis*length/2, target_center+measured_axis*length/2])
                angle = math.atan2(measured_axis[1], measured_axis[0])
                angle += round((theta-angle)/(2*math.pi))*2*math.pi
                variance = noise**2 / max(presence, np.finfo(float).eps)
                self.filter.measurementNoiseCov = np.diag([variance, variance, variance/max(span**2,self.pixel**2)])
                updated = self.filter.correct(np.array([target_center[0], target_center[1], angle]).reshape(3,1)).flatten()
                if dt > 0:
                    self.accelerations.append((updated[3:]-self.previous_velocity)/dt)
                self.previous_velocity = updated[3:].copy()
                self.last_seen = timestamp
                # Display current supported boundaries, not a lagging filtered
                # location. Filtering is only a prior for subsequent gaps.
        gap = None if self.last_seen is None else timestamp-self.last_seen
        ends = []
        for i, point in enumerate(positions):
            in_image = bool((point >= 0).all() and (point <= [self.width,self.height]).all())
            supported = visible[i] and in_image
            ends.append({"id":"ab"[i], "x":float(point[0]/self.width), "y":float(point[1]/self.height),
                         "state":"visible" if supported else "inferred", "visibility":presence if supported else 0.,
                         "confidence":presence if supported else 0., "spread":None,
                         "evidence":"mask boundary" if supported else "motion and length prior"})
        midpoint = positions.mean(0) / [self.width,self.height]
        return {"ends":ends,"midpoint":{"x":float(midpoint[0]),"y":float(midpoint[1]),
                    "state":"visible" if all(e["state"]=="visible" for e in ends) else "inferred"},
                "gapSeconds":gap,"visibleExtent":None if observed is None else (observed/[self.width,self.height]).tolist()}
