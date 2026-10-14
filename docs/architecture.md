# Architecture

`app/` is a native Kotlin/Compose Android application. `companion/` is a Node loopback relay and dependency-free browser UI. The only development dependency is Playwright.

## Phone pipeline

CameraX binds ImageAnalysis and VideoCapture to the activity lifecycle. It tries FHD/60, HD/60, HD/30, and SD/30 according to the selected target. Images are rotated into display orientation and mirrored by default for both cameras before both analysis and presentation, so staff coordinates and overlays share an image. VideoCapture uses the same mirror setting for the saved MP4. CameraX reports hardware zoom bounds; the default selects the minimum supported ratio.

A downsampled image (maximum 384 pixels on its long side) goes through an LED brightness/saturation mask or experimental edge mask. Boundary pixels vote into a bounded Hough transform. Candidate line segments need length, continuity, narrow cross-sections, and support from actual pixels. Nearby parallel edges are suppressed. Temporal assignment considers position, axis angle, and apparent length. Two staff slots cannot use the same candidate. Ambiguous assignments and newly acquired tracks are below the score threshold. Seeds bias assignment but never create detections.

The detector does not use a trained model, body pose, colored markers, or external inference. Bright elongated background objects remain a possible false positive. Pure shape confidence cannot prove semantic identity. Motion blur, illuminated sections separated by large dark gaps, partial occlusion, and strongly foreshortened staves are challenging.

Guide/scorer code is independent of Android, making synthetic pixel and geometric tests executable on the JVM. Segment coordinates are isotropic: x and y are divided by the shorter image dimension. The browser consumes the phone-generated geometry and metrics; it does not re-score real frames.

## Capture and review

Silent MP4s go to MediaStore's `Movies/Klobflow`. JSONL analysis and summary JSON files go to app-private `files/sessions`. Export is explicit through FileProvider or explicitly enabled LAN/USB requests. Frames include monotonic receive time, relative recording callback time, dimensions, staff endpoints/confidence, metrics, active guide, and configuration. Recording and analysis are asynchronous: relative timing is approximate, not frame-accurate MP4 synchronization. JSONL includes every analyzed sample, including missing values. There is no overlay baked into the MP4.

The browser can review JSONL exports with a scrubber and an error timeline. It intentionally calls this analysis replay; the matching video can be opened separately. Phone session summaries retain capture error codes. A process crash or force-stop can interrupt finalization, so recordings should be checked before treating them as complete. App-private measurements are removed by Android if the app is uninstalled; exported data and MediaStore videos persist according to Android storage behavior.

## Local protocol v2

Sharing explicitly starts a NanoHTTPD listener on 0.0.0.0:8787. Pairing codes were removed by user request. Anyone on the same network can access an enabled share. Browser-origin requests remain refused. Leaving the foreground stops capture and the listener; the enabled preference is retained and both resume on Activity.onStart. Pending camera callbacks and analyzers are invalidated by generation IDs.

- `GET /api/live`: current frame metadata, protocol/version, camera/recording/zoom status. No base64 image.
- `GET /api/stream`: continuous `application/x-klobflow-stream`; each packet has uint32 big-endian JSON length and JPEG length, UTF-8 metadata, then the matching JPEG. An all-zero header is a heartbeat. The phone keeps only the latest complete packet. Browser decoding likewise retains only the newest pending packet. The Node relay uses stream backpressure and aborts upstream when the browser disconnects. Preview frames follow analysis cadence, capped near 30 fps, rather than polling at 10 fps.
- `POST /api/control`: bounded JSON commands: `config`, `seed`, `calibrate`, `reset`, `record`, `stop`. Android dispatches mutations to the main thread.
- `GET /api/sessions`: completed session metadata.
- `GET /api/session?id=klobflow-<13-digit epoch>`: JSONL export.

The Node relay binds 127.0.0.1:8788 and validates Host, Origin, request size, numeric LAN addresses, and routes. It refuses redirects. USB uses `adb -d` to identify one physical device and an automatically allocated host port forwarded to phone TCP 8787. On WSL, Windows curl carries HTTP bodies through a local binary pipe to avoid exposing Windows loopback ports to the LAN. Only the tunnel created by this connection is removed on disconnect. The browser retries streams after phone background/reopen or cable reconnection.

## Plane calibration and visual feedback

Four normalized image corners and a known rectangle aspect ratio define forward and inverse homographies. Convex clockwise corner order and minimum area/edge lengths are validated. Guide geometry is created in the rectified plane and projected onto the image; circles render as sampled paths. Scoring rectifies endpoints before distances, angles, reflection symmetry, and angular-speed history are computed. Endpoints outside the calibrated area or a changed image aspect produce missing scores. Camera, mirror, zoom, or orientation changes invalidate calibration. This is planar perspective correction, not automatic pose/depth inference or lens calibration.

Each confident tip gets a nearest guide target and distance as a percentage of guide width. Green rings indicate the selected tolerance; orange arrows point toward off-target corrections. Cues are suppressed when either staff is uncertain or outside the calibrated plane. The status banner explicitly names tip adherence rather than grading overall skill.

## Release identity

Android application ID: `com.caleb.klobflow`. Debug builds add `.debug`. A stable external release keystore signs universal APKs; Android version codes increase monotonically. Klobstore consumes standard GitHub release APK assets and verifies installed package and signer state. Its v0.1.2 migration adds the new source once, retaining arbitrary user sources/preferences and respecting removal after migration.
