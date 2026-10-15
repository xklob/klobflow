"""Replay private footage in order; write predictions, never publish recordings.

python -m motion.evaluate --video sample.mp4 --seed 0.4,0.2,0.7,0.8 \
    --checkpoint /path/tapnextpp_ckpt.pt --output review/predictions.json
"""

import argparse
import json
from pathlib import Path
import subprocess
import time

import cv2
import numpy as np

from .vision import PointTracker, TapirTracker


def presentation_times(video):
    # MP4 video packets carry presentation timestamps. Sorting them accounts for
    # reordered B frames without decoding a 4K video a second time just for PTS.
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                            "-show_entries", "packet=pts_time", "-of", "json", video],
                           check=True, capture_output=True, text=True)
    return sorted(float(packet["pts_time"]) for packet in json.loads(probe.stdout)["packets"])


def cached_frames(video, path, start):
    """Replay an existing complete 384x216 BGRA reference decode, with source PTS."""
    times = presentation_times(video)
    frames = np.memmap(path, mode="r", dtype=np.uint8).reshape(-1,216,384,4)
    if len(frames) != len(times):
        raise RuntimeError("Cached frames do not match the source packet count")
    for index in range(start,len(frames)):
        yield index,times[index],cv2.resize(frames[index,:,:,:3],(768,432))


def ffmpeg_frames(video, start):
    """Use system FFmpeg for phone HEVC files the OpenCV build cannot decode.

    Keep source presentation times and frame numbers. No fps conversion or
    seeking across a damaged reference picture; decode sequentially from zero.
    """
    times = presentation_times(video)
    process = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-an", "-sn", "-vf", "scale=768:432",
                                "-fps_mode", "passthrough", "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1"],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    index = 0
    try:
        while True:
            data = process.stdout.read(768 * 432 * 3)
            if not data:
                break
            if len(data) != 768 * 432 * 3 or index >= len(times):
                raise RuntimeError("Decoded frames do not match the source timestamps")
            if index >= start:
                yield index, times[index], np.frombuffer(data, np.uint8).reshape(432, 768, 3)
            index += 1
        if process.wait() != 0 or index != len(times):
            raise RuntimeError(f"Decoder stopped at frame {index}; expected {len(times)}. Results are incomplete.")
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.terminate()
            process.wait()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--seed", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--frames", type=int, default=0)
    parser.add_argument("--stride", type=int, default=1)
    parser.add_argument("--model", choices=("tapnext", "tapir", "edgetam"), default="edgetam")
    parser.add_argument("--resolution", type=int, default=512)
    parser.add_argument("--decoder", choices=("opencv", "ffmpeg", "cached"), default="opencv")
    parser.add_argument("--raw-cache", help="Existing complete 384x216 BGRA reference frames, for --decoder cached")
    parser.add_argument("--include-labels", help="Optional local annotation JSON; retain its matching clip frames when subsampling")
    args = parser.parse_args()
    if args.model == "edgetam":
        from .segmentation import SegmentationTracker
        tracker = SegmentationTracker(args.checkpoint, resolution=args.resolution)
    else:
        tracker = (PointTracker if args.model == "tapnext" else TapirTracker)(args.checkpoint)
    points = np.array([float(v) for v in args.seed.split(",")]).reshape(2, 2)
    capture = cv2.VideoCapture(args.video)
    if not capture.isOpened():
        raise RuntimeError("Could not open the video")
    capture.set(cv2.CAP_PROP_POS_FRAMES, args.start)
    fps = capture.get(cv2.CAP_PROP_FPS)
    expected_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    def opencv_frames():
        index = args.start
        while True:
            ok, frame = capture.read()
            if not ok:
                if index < expected_frames:
                    raise RuntimeError(f"OpenCV stopped at frame {index} of {expected_frames}; retry with --decoder ffmpeg")
                return
            yield index, capture.get(cv2.CAP_PROP_POS_MSEC) / 1000, cv2.resize(frame, (768,432))
            index += 1
    if args.decoder == "cached" and not args.raw_cache:
        parser.error("--decoder cached requires --raw-cache")
    frames = cached_frames(args.video,args.raw_cache,args.start) if args.decoder == "cached" else (
        ffmpeg_frames(args.video, args.start) if args.decoder == "ffmpeg" else opencv_frames())
    results = []
    retained = set()
    if args.include_labels:
        labels = json.loads(Path(args.include_labels).read_text())
        clips = {key for key, clip in labels["clips"].items()
                 if Path(clip["video"]).resolve() == Path(args.video).resolve()}
        retained = {frame["index"] for frame in labels["frames"] if frame["clip"] in clips}
    start = time.monotonic()
    index = args.start
    try:
        for index, timestamp, frame in frames:
            if args.frames and index >= args.start + args.frames:
                break
            if (index - args.start) % args.stride == 0 or index in retained:
                result = tracker.track(frame, timestamp, points if not results else None)
                result["index"] = index
                results.append(result)
                if len(results) == 1:
                    print("Initial observation: " + json.dumps(result), flush=True)
                if len(results) == 1 or len(results) % 100 == 0:
                    Path(args.output).write_text(json.dumps({"summary":{"complete":False,"processed":len(results)},"frames":results}))
                if len(results) % 10 == 0:
                    print(f"{index}: {len(results)/(time.monotonic()-start):.1f} processed frames/sec", flush=True)
    finally:
        frames.close()
        capture.release()
    times = [r["inferenceMs"] for r in results]
    if not results:
        raise ValueError("No frames were processed; check the start frame and video")
    summary = {"complete": True,"sourceFps": fps,"decoder":args.decoder,"lastFrame":index,"sourceFrames":expected_frames,
               "processed": len(results), "stride": args.stride, "retainedLabelFrames": len(retained),
               "device": str(tracker.device), "meanInferenceMs": float(np.mean(times)),
               "p95InferenceMs": float(np.percentile(times, 95))}
    Path(args.output).write_text(json.dumps({"summary": summary, "frames": results}))
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
