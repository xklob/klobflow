# Architecture

## Alignment streaks (0.6.0)

`FlowStreak.kt` and `streak.mjs` award elapsed monotonic time only between consecutive fully observed, confident, on-guide frames. Every selected tip must meet tolerance individually; RMS error cannot hide an off-guide endpoint. Geometry cues use the same rectified practice plane as ordinary measurements. Blurred, occluded, missing, or low-confidence observations pause credit, and uncertainty beyond 350 ms clears the active streak. Gaps over 250 ms clear the active timer without adding unobserved time. Guide/camera/prop-count/tolerance changes or backward time clear the attempt and best; explicit reacquisition resets the model.

Levels advance at 2, 5, and 10 seconds. A smoothed, bounded energy value controls tip halos, trail size, progress rings, and at most eight orbiting particles per tip. These draw with the existing preview, without another animation timer. Motion preferences stop particle rotation. Free flow and disabled effects award no alignment time. Precision and beat scores are unchanged. The phone remains authoritative for companion streak state; local webcam practice computes it in the analysis worker. JSONL frames include the state for replay, with a browser fallback for older files. Native/browser fixture comparisons and frame-rate-independent tests guard parity.

## Motion and readable feedback (0.5.1)

The native/browser LED detector fits bright connected regions and pairs luminous ends across a dark grip, without selecting a straight edge through a branched window. It handles connected light spill and uses a bounded Hough fallback for crossings or unlit props. Near recent motion-predicted staves, a background-adaptive dim-light mask also joins luminous halves belonging to the same prior staff and fits the observed light distribution. Shape, length, position, and angular gates reject broad blobs and unrelated regions. The fit uses brightness/chroma within each frame without assigning persistent color identities, so changing rainbow patterns are supported.

Broad exposure sweeps produce `blurred: true` observations with confidence below the precision threshold. Dim recovery retains the recent staff length around the observed axis; incomplete extents also retain the along-axis center. This avoids jumps between whichever rainbow tip is brightest. These outlines and their dimmer trails are approximate. They cannot earn guide scores, fit calibration, or beat hits. A 250 ms detector-prior window, 350 ms expiry for uncertain blur association, and 1.5-second expiry for previously clear occluded tracks prevent indefinite prediction without image evidence. Angular/center velocity improve association at fast rotation rates.

`AlignmentFeedback` / `feedback.mjs` stabilize presentation without imposing another delay after the tracker confirms observed ends. Valid observations immediately restore correction rings and measurements. On-guide tip labels still need a margin and 300 ms confirmation; the overall on-guide message needs 1.2 seconds. A confidence loss immediately suppresses precision guidance. Held text and slow fades remain separate from measurement validity.

`GlowBody.kt` / `glowBodyEndpoints` in `core.mjs` can recover visible caps from a candidate whose surrounding glow is too broad. A bounded search isolates the brightest connected shaft sections, fits their axis, verifies support along both halves, limits end spread and curvature, then locates each observed cap across the shaft. Small detached reflections cannot extend a cap. The pass uses current pixels and never upgrades a broad fan, clipped end, or isolated pair of lights merely because a prior staff was present. Synthetic fixtures and an optional private-video replay check native/browser parity.

Browser mode negotiation tries required frame-rate ranges and backs off unsupported combinations. All later zoom/exposure constraints retain capture-mode constraints. Live diagnostics distinguish configured and delivered frame rates. Both native and browser analysis consume the next available frame without queuing or the former 30 ms submission throttle.

`app/` is a native Kotlin/Compose Android application. `companion/` is a Node loopback relay and dependency-free browser UI. The only development dependency is Playwright.

## Phone pipeline

CameraX binds ImageAnalysis and VideoCapture to the activity lifecycle. It tries FHD/60, HD/60, HD/30, and SD/30 according to the selected target. Images are rotated into display orientation and mirrored by default for both cameras before both analysis and presentation, so staff coordinates and overlays share an image. VideoCapture uses the same mirror setting for the saved MP4. CameraX reports hardware zoom bounds; the default selects the minimum supported ratio.

A downsampled image (maximum 384 pixels on its long side) goes through an LED brightness/saturation mask or experimental edge mask. LED regions are fitted and paired as above; the edge/crossing fallback votes boundary pixels into a bounded Hough transform. Candidate line segments need length, continuity, narrow cross-sections, and support from actual pixels. Nearby parallel edges are suppressed. Temporal assignment considers position, axis angle, and apparent length. Two staff slots cannot use the same candidate. Ambiguous assignments and newly acquired tracks are below the score threshold. Seeds bias assignment but never create detections.

The detector does not use a trained model, body pose, colored markers, or external inference. Bright elongated background objects remain a possible false positive. Pure shape confidence cannot prove semantic identity. Motion blur, illuminated sections separated by large dark gaps, partial occlusion, and strongly foreshortened staves are challenging.

Guide/scorer code is independent of Android, making synthetic pixel and geometric tests executable on the JVM. Segment coordinates are isotropic: x and y are divided by the shorter image dimension. The browser consumes the phone-generated geometry and metrics; it does not re-score real frames.

## Capture and review

Silent MP4s go to MediaStore's `Movies/Klobflow`. JSONL analysis and summary JSON files go to app-private `files/sessions`. Export is explicit through FileProvider or explicitly enabled LAN/USB requests. Frames include monotonic receive time, relative recording callback time, dimensions, staff endpoints/confidence, metrics, active guide, and configuration. Recording and analysis are asynchronous: relative timing is approximate, not frame-accurate MP4 synchronization. JSONL includes every analyzed sample, including missing values. There is no overlay baked into the MP4.

The browser can review JSONL exports with a scrubber and an error timeline. It intentionally calls this analysis replay; the matching video can be opened separately. Phone session summaries retain capture error codes. A process crash or force-stop can interrupt finalization, so recordings should be checked before treating them as complete. App-private measurements are removed by Android if the app is uninstalled; exported data and MediaStore videos persist according to Android storage behavior.

## Local protocol v2

Sharing explicitly starts a NanoHTTPD listener on 0.0.0.0:8787. Pairing codes were removed by user request. Anyone on the same network can access an enabled share. Browser-origin requests remain refused. Leaving the foreground stops capture and the listener; the enabled preference is retained and both resume on Activity.onStart. Pending camera callbacks and analyzers are invalidated by generation IDs.

- `GET /api/live`: current frame metadata, protocol/version, camera/recording/zoom status. No base64 image.
- `GET /api/stream`: continuous `application/x-klobflow-stream`; each packet has uint32 big-endian JSON length and JPEG length, UTF-8 metadata, then the matching JPEG. An all-zero header is a heartbeat. The phone keeps only the latest complete packet. Browser decoding likewise retains only the newest pending packet. The Node relay uses stream backpressure and aborts upstream when the browser disconnects. Preview frames follow the available analysis cadence without a fixed 30 fps cap.
- `POST /api/control`: bounded JSON commands: `config`, `seed`, `calibrate`, `reset`, `record`, `stop`. Android dispatches mutations to the main thread.
- `GET /api/sessions`: completed session metadata.
- `GET /api/session?id=klobflow-<13-digit epoch>`: JSONL export.

The Node relay binds 127.0.0.1:8788 and validates Host, Origin, request size, numeric LAN addresses, and routes. It refuses redirects. USB uses `adb -d` to identify one physical device and an automatically allocated host port forwarded to phone TCP 8787. On WSL, Windows curl carries HTTP bodies through a local binary pipe to avoid exposing Windows loopback ports to the LAN. Only the tunnel created by this connection is removed on disconnect. The browser retries streams after phone background/reopen or cable reconnection.

## Plane calibration and visual feedback

Four normalized image corners and a known rectangle aspect ratio define forward and inverse homographies. Convex clockwise corner order and minimum area/edge lengths are validated. Guide geometry is created in the rectified plane and projected onto the image; circles render as sampled paths. Scoring rectifies endpoints before distances, angles, reflection symmetry, and angular-speed history are computed. Endpoints outside the calibrated area or a changed image aspect produce missing scores. Camera, mirror, zoom, or orientation changes invalidate calibration. This is planar perspective correction, not automatic pose/depth inference or lens calibration.

Each confident tip gets a nearest guide target and distance as a percentage of guide width. Green rings indicate the selected tolerance; orange arrows point toward off-target corrections. Cues are suppressed when either staff is uncertain or outside the calibrated plane. The status banner explicitly names tip adherence rather than grading overall skill.

## Release identity

Android application ID: `com.caleb.klobflow`. Debug builds add `.debug`. A stable external release keystore signs universal APKs; Android version codes increase monotonically. Klobstore consumes standard GitHub release APK assets and verifies installed package and signer state. Its v0.1.2 migration adds the new source once, retaining arbitrary user sources/preferences and respecting removal after migration.

## Browser camera engine (0.3.0)

`browser-camera.mjs` owns getUserMedia, capture-profile measurement, lifecycle, hardware zoom, and MediaRecorder/IndexedDB sessions. Native video preview is independent of a single-in-flight worker (`tracker-worker.mjs`) that analyzes mirrored 384-pixel images. `core.mjs` ports the deterministic native detector, tracker, geometry, homography, and scorer. Native-generated committed fixtures are checked by both JVM and Node tests, including nonzero perspective measurements and occlusion.

Hidden tips retain association memory for 1.5 seconds, with confidence below the scoring threshold and an explicit occluded field. A shortened segment cannot supply a precise unseen endpoint. Three observations are required for reacquisition; identities can still be ambiguous after long or overlapping occlusion.

## Audio tempo (0.5.0)

Android uses a user-approved `mediaProjection` foreground service and `AudioPlaybackCaptureConfiguration`. PCM becomes 20 ms low-band/full-band energy samples; a bounded eight-second periodicity window estimates BPM, phase, and confidence. The implementation adapts the local Prism visualizer's periodicity approach. Only estimated rhythm enters frame exports. No microphone source, screen image buffer, or audio recording is created.

The browser's user-initiated `getDisplayMedia` receives a system/tab audio track. An AudioWorklet calculates the same energy envelope and a dedicated worker calculates periodicity. Silence and low confidence clear a usable tempo. Capture is explicitly stoppable, and missing audio tracks release the selected stream with an explanation. Native/browser PCM fixtures compare estimate outputs.

For PC audio with Android camera tracking, `/api/clock` samples the phone monotonic clock. The browser picks the lowest round trip of three samples and refreshes every 20 seconds. Rhythm messages include converted beat origin, confidence, and sample age. The Android engine expires PC tempo after two seconds. Unsynchronized or invalid rhythm messages are rejected. Camera frames and authoritative Android beat measurements remain timestamped by the phone.

Fitting revisions prevent queued automatic fit updates from overwriting later manual guide/camera edits.

## Fixed background and LED colors

BackgroundFilter is the same model in Kotlin and the browser worker. A manual command starts a five-second countdown, then averages at least four RGB frames over at least 400 ms. Analysis is masked while capturing; preview frames are unaffected. The fixed baseline removes pixels within 32 levels per RGB channel. Captured bright pixels also tolerate intensity changes when normalized RGB remains close; newly bright foreground over a dark baseline is retained. It never adapts after capture, preserving stationary foreground staves. It is RAM-only and cleared when the camera's pixel coordinate system changes or capture restarts. Explicit browser exposure changes clear it too. Physical camera movement and major lighting changes require manual recapture.

The optional staffColors list selects one or several LED hues. Empty means unrestricted rainbow tracking. A linear-time integral image admits neutral LED cores only near matching colored pixels; explicit white selection accepts neutral light directly. This filter runs before both sharp and blurred LED candidate extraction. Color changes reset tracking association; colors are not a promise of staff identity. Background/color filtering cannot recover details identical to the baseline or hidden by clipping/occlusion.

RollingErrors retains five seconds of valid observed deviation, angle, and symmetry samples. The current raw validity always gates display. Frame.averagedMetrics carries these readouts separately from raw frame.metrics; raw metrics still drive recordings, streaks, and timing. Target/detector/camera changes reset the average.

Startup fitting is disabled, including for restored legacy autoFit:true settings. Only an explicit fit command starts collection. Reset guide layout patches the five layout fields while retaining unrelated settings. Camera startup retries bounded compatible modes for transient source failures and releases capture tracks before asynchronous recording finalization.
