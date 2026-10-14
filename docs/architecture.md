# Architecture

`app/` is a native Kotlin/Compose Android application. `companion/` is a Node loopback relay and dependency-free browser UI. The only development dependency is Playwright.

## Phone pipeline

CameraX binds ImageAnalysis and VideoCapture to the activity lifecycle. It tries FHD/60, HD/60, HD/30, and SD/30 according to the selected target. Images are rotated into display orientation and mirrored for the front camera before both analysis and presentation, so staff coordinates and overlays share an image. The recorded MP4 uses CameraX's native orientation and is not mirrored by the analysis transformation.

A downsampled image (maximum 384 pixels on its long side) goes through an LED brightness/saturation mask or experimental edge mask. Boundary pixels vote into a bounded Hough transform. Candidate line segments need length, continuity, narrow cross-sections, and support from actual pixels. Nearby parallel edges are suppressed. Temporal assignment considers position, axis angle, and apparent length. Two staff slots cannot use the same candidate. Ambiguous assignments and newly acquired tracks are below the score threshold. Seeds bias assignment but never create detections.

The detector does not use a trained model, body pose, colored markers, or external inference. Bright elongated background objects remain a possible false positive. Pure shape confidence cannot prove semantic identity. Motion blur, illuminated sections separated by large dark gaps, partial occlusion, and strongly foreshortened staves are challenging.

Guide/scorer code is independent of Android, making synthetic pixel and geometric tests executable on the JVM. Segment coordinates are isotropic: x and y are divided by the shorter image dimension. The browser consumes the phone-generated geometry and metrics; it does not re-score real frames.

## Capture and review

Silent MP4s go to MediaStore's `Movies/Klobflow`. JSONL analysis and summary JSON files go to app-private `files/sessions`. Export is explicit through FileProvider or authenticated LAN requests. Frames include monotonic receive time, relative recording callback time, dimensions, staff endpoints/confidence, metrics, active guide, and configuration. Recording and analysis are asynchronous: relative timing is approximate, not frame-accurate MP4 synchronization. JSONL includes every analyzed sample, including missing values. There is no overlay baked into the MP4.

The browser can review JSONL exports with a scrubber and an error timeline. It intentionally calls this analysis replay; the matching video can be opened separately. Phone session summaries retain capture error codes. A process crash or force-stop can interrupt finalization, so recordings should be checked before treating them as complete. App-private measurements are removed by Android if the app is uninstalled; exported data and MediaStore videos persist according to Android storage behavior.

## LAN protocol v1

Sharing explicitly starts a NanoHTTPD listener on 0.0.0.0:8787 with a fresh random 64-bit pairing token. Every endpoint needs `X-Klobflow-Token`. Browser-origin requests are refused, and there is no CORS allowance. Only the loopback Node server forwards authenticated requests. Leaving the foreground stops the listener and camera.

- `GET /api/live`: a single JSON packet containing matching JPEG, dimensions, guide, measurements, frame time, and source; plus current capture/control status.
- `POST /api/control`: bounded JSON commands: `config`, `seed`, `reset`, `record`, `stop`. Android dispatches mutations to the main thread and reports failures.
- `GET /api/sessions`: completed session metadata.
- `GET /api/session?id=klobflow-<13-digit epoch>`: a JSONL export with strict filename validation.

The Node relay binds 127.0.0.1:8788. It validates Host, Origin, request size, numeric LAN addresses, pairing token shape, and route names; it rejects redirects. No secrets are put in query strings or storage. HTTP is unencrypted; use a trusted LAN. Cameras/analysis stop while the app is in the background, rather than starting an unrequested foreground service.

## Release identity

Android application ID: `com.caleb.klobflow`. Debug builds add `.debug`. A stable external release keystore signs universal APKs; Android version codes increase monotonically. Klobstore consumes standard GitHub release APK assets and verifies installed package and signer state. Its v0.1.2 migration adds the new source once, retaining arbitrary user sources/preferences and respecting removal after migration.
