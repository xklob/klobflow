"""Local-only motion laboratory. Video is processed here and never uploaded.

Run with: python -m motion.server --port 8789
"""

from __future__ import annotations

import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import ipaddress
import io
import json
import math
import os
from pathlib import Path
import shutil
import time

import cv2
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import numpy as np
from PIL import Image, UnidentifiedImageError
import uvicorn

from .calibration import Geometry, calibrate_checkerboard
from .protocol import decode, encode

ROOT = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("KLOBFLOW_MODEL_DIR", Path.home() / ".cache/klobflow/models"))


def local_host(value):
    return value.split(":")[0] in {"localhost", "127.0.0.1"}


def check_origin(headers):
    host = headers.get("host", "")
    origin = headers.get("origin")
    return local_host(host) and (origin is None or origin == f"http://{host}")


def private_address(value):
    host, separator, port = value.partition(":")
    ip = ipaddress.IPv4Address(host)
    ranges = [ipaddress.ip_network(v) for v in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.1/32")]
    if not any(ip in network for network in ranges) or not 1 <= int(port or 8787) <= 65535:
        raise ValueError("Use the private IPv4 address shown on the phone")
    return f"{ip}:{int(port or 8787)}"


class Runtime:
    def __init__(self, kind="edgetam"):
        self.kind = kind
        self.tracker = None
        self.error = None
        self.loading = False
        self.owner = None
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="klobflow-model")

    async def run(self, fn, *args):
        return await asyncio.get_running_loop().run_in_executor(self.executor, fn, *args)

    def load(self):
        self.loading = True
        try:
            from .segmentation import SegmentationTracker
            cls, filename = SegmentationTracker, "edgetam.pt"
            if not (CACHE / filename).is_file():
                raise RuntimeError("Run motion/setup.sh to install the local model")
            self.tracker = cls(CACHE / filename, tip_checkpoint=os.environ.get("KLOBFLOW_TIP_CHECKPOINT"))
        except Exception as error:
            self.error = str(error)
        finally:
            self.loading = False

    def status(self):
        return {"version": "0.14.0-alpha.2", "ready": self.tracker is not None,
                "loading": self.loading, "error": self.error,
                "model": self.tracker.name if self.tracker else self.kind,
                "device": str(self.tracker.device) if self.tracker else None,
                "busy": self.owner is not None}


def create_app(runtime=None, preload=True):
    runtime = runtime or Runtime()

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(runtime.run(runtime.load)) if preload else None
        yield
        if task:
            await task
        runtime.executor.shutdown(wait=True, cancel_futures=True)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.runtime = runtime

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        if not check_origin(request.headers):
            return JSONResponse({"error": "Open this app directly on localhost"}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = "default-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"
        return response

    @app.get("/api/status")
    async def status():
        return runtime.status()

    @app.get("/api/phone-stream")
    async def phone_stream(transport: str = "lan", address: str = ""):
        if transport not in {"lan", "usb"}:
            raise HTTPException(400, "Choose Wi-Fi or USB")
        try:
            address = private_address(address) if transport == "lan" else ""
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        node = shutil.which("node")
        if not node:
            raise HTTPException(503, "Node.js is required for the phone transport")
        process = await asyncio.create_subprocess_exec(
            node, str(ROOT / "phone-bridge.mjs"), transport, address,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )

        async def stop():
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 3)
                except TimeoutError:
                    process.kill()
                    await process.wait()

        try:
            first = await asyncio.wait_for(process.stdout.read(65536), 18)
            if not first:
                message = (await process.stderr.read(4096)).decode(errors="replace").strip()
                raise HTTPException(502, message or "No video from the phone. Enable sharing and reconnect.")
        except TimeoutError as error:
            await stop()
            raise HTTPException(504, "The phone did not send video. Open the camera app and enable sharing, then reconnect.") from error
        except BaseException:
            await stop()
            raise

        async def chunks():
            try:
                yield first
                while chunk := await process.stdout.read(65536):
                    yield chunk
            finally:
                await stop()
        return StreamingResponse(chunks(), media_type="application/x-klobflow-stream")

    @app.websocket("/ws/track")
    async def track(ws: WebSocket):
        if not check_origin(ws.headers):
            await ws.close(code=1008)
            return
        await ws.accept()
        if runtime.owner is not None:
            await ws.send_json({"type": "error", "error": "Tracking is active in another tab. Stop it there first."})
            await ws.close(code=1013)
            return
        if runtime.tracker is None:
            await ws.send_json({"type": "error", "error": runtime.error or "The local vision model is still loading"})
            await ws.close(code=1013)
            return
        runtime.owner = ws
        geometry = Geometry()
        calibration_frames = []
        try:
            await runtime.run(runtime.tracker.reset)
            await ws.send_json({"type": "ready", **runtime.status()})
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                try:
                    if message.get("text") is not None:
                        if len(message["text"]) > 131072:
                            raise ValueError("Command is too large")
                        command = json.loads(message["text"])
                        if not isinstance(command, dict):
                            raise ValueError("Expected a command object")
                        action = command.get("type")
                        if action == "reset":
                            await runtime.run(runtime.tracker.reset)
                            await ws.send_json({"type": "reset"})
                        elif action == "geometry":
                            geometry.configure(command.get("lens"), command.get("corners"), command.get("aspect", 1.0))
                            await runtime.run(runtime.tracker.reset)
                            await ws.send_json({"type": "geometry", "ok": True})
                        elif action == "calibrate":
                            result = await runtime.run(calibrate_checkerboard, calibration_frames,
                                                       int(command.get("columns", 9)), int(command.get("rows", 6)),
                                                       command.get("model", "pinhole"))
                            await ws.send_json({"type": "calibrated", **result})
                        elif action == "clearCalibration":
                            calibration_frames.clear()
                            await ws.send_json({"type": "calibrationCapture", "count": 0})
                        else:
                            raise ValueError("Unknown command")
                        continue
                    metadata, jpeg = decode(message["bytes"])
                    if not isinstance(metadata.get("id"), int) or not isinstance(metadata.get("time"), (int, float)):
                        raise ValueError("Frame identity and time are required")
                    if not math.isfinite(metadata["time"]):
                        raise ValueError("Frame time must be finite")
                    # Inspect the header before allocating decoded image memory.
                    try:
                        with Image.open(io.BytesIO(jpeg)) as header:
                            if header.format != "JPEG" or max(header.size) > 4096:
                                raise ValueError("Use a JPEG frame at most 4096 pixels wide or high")
                    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
                        raise ValueError("Use a valid JPEG frame") from error
                    image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
                    if image is None or max(image.shape[:2]) > 4096:
                        raise ValueError("Use a JPEG frame at most 4096 pixels wide or high")
                    if metadata.get("calibrationCapture"):
                        if len(calibration_frames) >= 30:
                            raise ValueError("Thirty views are enough; solve calibration or clear the set")
                        calibration_frames.append(image)
                        await ws.send_json({"type": "calibrationCapture", "count": len(calibration_frames), "id": metadata["id"]})
                        continue
                    image = await runtime.run(geometry.apply, image)
                    if metadata.get("previewOnly"):
                        result = {"ends": [], "midpoint": None, "time": metadata["time"]}
                    else:
                        result = await runtime.run(runtime.tracker.track, image, metadata["time"], metadata.get("seed"))
                    result.update({"type": "frame", "id": metadata["id"], "width": image.shape[1], "height": image.shape[0]})
                    # Return the exact analysed frame. Never paint its estimates on a newer image.
                    _, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 88])
                    await ws.send_bytes(encode(result, encoded.tobytes()))
                except (ValueError, KeyError, TypeError, RuntimeError, cv2.error) as error:
                    await ws.send_json({"type": "error", "error": str(error)})
        except WebSocketDisconnect:
            pass
        finally:
            # ASGI cancellation can interrupt even this cleanup await. Always
            # release the session; a new owner resets the model on the same
            # serialized executor before submitting any of its frames.
            try:
                await runtime.run(runtime.tracker.reset)
            finally:
                runtime.owner = None

    assets = {"/": "index.html", "/app.mjs": "app.mjs", "/style.css": "style.css", "/view.mjs": "view.mjs", "/checkerboard.svg": "checkerboard.svg"}
    primitives = {"/camera.mjs": "camera.mjs", "/stream.mjs": "stream.mjs"}

    @app.get("/{path:path}")
    async def files(path: str):
        route = f"/{path}"
        if route in assets:
            file = ROOT / "public" / assets[route]
        elif route in primitives:
            file = ROOT.parent / "companion/public" / primitives[route]
        else:
            raise HTTPException(404)
        if not file.is_file():
            raise HTTPException(404)
        return FileResponse(file)
    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8789)
    args = parser.parse_args()
    uvicorn.run(create_app(Runtime()), host="127.0.0.1", port=args.port,
                ws_max_size=4 * 1024 * 1024 + 131080, ws_max_queue=1)


if __name__ == "__main__":
    main()
