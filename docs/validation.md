# v0.8.0 validation

Validated locally on 2026-10-14.

- 69 regular JVM tests and 53 Node tests pass, plus Android lint/debug builds. Five emulator integration flows pass, including generated antispin through the real native detector, one-staff enforcement, per-axis feedback in fullscreen, four turnaround targets, camera switching/recovery, recording/decoding and playback audio. A video replay diagnostic is optional and skipped in the ordinary JVM suite.
- Native/browser parity covers 324 generated antispin frames across rotation, perspective correction, endpoint reversal and missing observations. Independent expected-value checks verify that both ends cannot use the same axis, shaft angle is not scored, off-axis drift has the right scale, size matching uses a full staff length per cross arm, and early/late timing remains separate from positional error in either direction.
- Seventeen browser flows pass. The seven practice/UI flows are repeated after moving the antispin streak meter and demo label below the image, where they cannot obscure an outer target. Desktop large text, fullscreen and mobile layouts are inspected; no horizontal mobile overflow or page errors. README screenshots use generated motion only.
- Replaying both existing private Pixel recordings preserves v0.7.1 tracking results: 2,161 measured and 2,469 observed frames among 2,661 in the recent practice session; 656 measured and 1,509 observed among 1,910 in the original recording. The detector itself is unchanged in this release. These recordings are regression inputs, not annotated ground truth for antispin. Physical antispin endpoint accuracy and end-to-end latency remain unmeasured.
- Antispin is a projected line-tracing exercise. The two ends are jointly assigned to separate finite cross segments. Timing estimates outer turnarounds from their combined cycle phase; it does not classify arbitrary antispin variations. Uncertain, hidden, or blurred endpoints cannot earn precision, beat hits or streak time.
- Package and signing identity remain unchanged; Android versionCode is 11. Klobstore's existing catalog entry follows the new GitHub release. Signed artifacts, checksums, matching companion source, remote refs and CI are checked during publication. All private footage and derived images remain outside Git and release assets.

# v0.7.1 validation

Validated locally on 2026-10-14.

- The primary new regression is the privately supplied Pixel app recording: 44.733 seconds, 2,661 decoded frames, approximately 59.5 fps, originally 1920 × 1080. It was copied from the phone together with its saved telemetry, without modifying the recording or current settings. Replay uses original presentation timestamps and the live detector's 384 × 216 analysis size. Saved settings include one staff, Circles, threshold 250, minimum apparent length 36%, guide size 48%, and tolerance 15%.
- Under identical replay conditions, v0.7.0 supplies 1,864 measurable frames (70.0%); v0.7.1 supplies 2,161 (81.2%). Observed tracking remains 2,469. In the 5–40 second interval, measured frames improve from 1,547 to 1,818 of 2,082. The original Pixel 4K/60 clip also improves: 544 → 656 measured frames, with 1,509 observed among 1,910 total. Native/browser parity checks compare endpoint coordinates, confidence, blur and occlusion on every frame of both clips, all 4,571 combined.
- These are measured-frame availability counts, not independently annotated endpoint accuracy or a claim that practice was on target. Saved live telemetry and offline decoded-video replay differ in scaling and timestamps; the before/after comparison above runs both versions on exactly the same decoded pixels. Visual spot checks compare new cap locations to the recording. Private footage, frame exports and telemetry stay outside Git and release assets.
- 64 regular JVM checks, 49 Node checks and 16 browser flows cover saturated blue bodies with white caps, clipped halos versus clipped caps, isolated bulbs, broad exposure fans, resumed clear observations, missing/expired reacquisition, selected colors, background lights, rolling feedback, brief occlusion, extended tolerance, transport, recording, camera recovery and timing. An additional opt-in JVM check runs separately for each private video. Hidden and blurred current observations still produce no valid precision score.
- Android lint/debug/release builds and four disposable-emulator integration flows cover the native UI, fullscreen rotation, camera lifecycle, recording/decoding, background capture and audio. Desktop/fullscreen and mobile UI views are inspected with generated imagery. Updated README screenshots show the new trail hues and status summaries; no user footage is published.
- Target tolerance accepts 1–50% in the native and browser validators and both sliders. A browser test verifies a value above the old cap reaches the phone control endpoint. Klobflow remains in the published Klobstore v0.1.3 default catalog and migration. Package com.caleb.klobflow and the existing signing certificate are preserved; versionCode increases to 10. Release hashes, remote source/tag and GitHub checks are verified during publication.

Replay with saved settings: `node scripts/evaluate-video.mjs VIDEO review/analysis.json 1 CONFIG.json`. The video must already match the saved orientation/mirroring. For native comparison, use that report and matching raw BGRA frames with `KLOBFLOW_REPLAY_JSON` and `KLOBFLOW_REPLAY_BGRA`, and force the diagnostic task to execute with `./gradlew testDebugUnitTest --rerun --tests com.caleb.klobflow.VideoReplayTest`. End-to-end live latency and controlled endpoint ground truth remain unmeasured.

# v0.7.0 validation

Validated locally on 2026-10-14.

- 58 regular JVM and 43 Node checks retain native/browser detection and measurement parity. An additional opt-in JVM check replays the private Pixel recording. Android lint and builds pass. New regressions cover bright shafts inside broad colored halos, dark grips, red LEDs, detached bright reflections, clipped ends, and immediate recovery of valid feedback without rapid text changes.
- The full Pixel clip is the primary tracking regression: 1,910 frames at original presentation timestamps, analyzed at 384 × 216. Android and browser agree frame by frame, including endpoints, confidence, blur, and occlusion. Clear-end measurements increase from 49 to 544 while observed tracking remains at 1,509 frames. The 2–28 second practice section retains 1,409/1,547 observed frames (91.1%), with 538 supporting precision feedback. Visual checks compare recovered caps to the actual glow boundaries; this caught and fixed detached tapestry reflections extending an endpoint. These counts measure coverage/confidence, not independently annotated accuracy. Private frames and comparison images remain outside Git and release assets.
- Sixteen browser flows cover PC capture, recording from fullscreen and decoded playback, source recovery, phone streaming, live calibration, background capture/cancellation through the new shortcut, selected colors, audio detection, replay, and rainbow spins. Estimated system-audio tempo is checked within 2 BPM, while manual tempo remains exact.
- Quick setup and tutorial expansion/dismissal are exercised with real pointer/keyboard focus. A reproduced sticky-sidebar overlap at narrower desktop widths is fixed. Large text with populated beat feedback keeps the whole preview within a 1920 × 1080 viewport. Generated screenshots also inspect 1600 × 1000, 390 × 844, and fullscreen layouts.
- Four Android emulator integration flows pass. The practice flow enters fullscreen, verifies the preview bounds, rotates to landscape, returns to portrait, exits, and confirms that frames continue. Camera/sharing recovery, recording, background capture, timing, and playback-audio checks remain covered.
- Klobflow is confirmed in the published Klobstore v0.1.3 default catalog and its one-time migration from older catalogs. The current checkout's five catalog migration tests pass. ADB also confirms Klobstore v0.1.3 is installed on the Pixel. The release APK retains package `com.caleb.klobflow` and increases the version code to 9.
- README screenshots use generated practice. Signed publication artifacts, hashes, certificate continuity, and GitHub checks are verified during release.

The endpoint recovery uses current image evidence rather than making an occlusion prediction count as precision. Broad exposure fans, clipped ends, and ambiguous shapes still pause scoring. No new physical LED practice run was performed in this pass; the supplied Pixel recording provides the real-camera regression. End-to-end live latency and annotated endpoint accuracy remain unmeasured.

The local replay diagnostic can also check native/browser parity without publishing recordings. Run `scripts/evaluate-video.mjs` to obtain a JSON report, decode matching frames to raw BGRA at the report's analysis dimensions with FFmpeg using `-fps_mode passthrough`, then run `VideoReplayTest` with `KLOBFLOW_REPLAY_JSON` and `KLOBFLOW_REPLAY_BGRA` pointing to those local files. It is skipped when the paths are absent. Browser integration tests now own a separate server on port 8878, avoiding interruption of normal practice on port 8788.

# v0.6.1 validation

Validated locally on 2026-10-14.

- 54 JVM and 39 Node tests pass. New cases cover a fixed background baseline, exposure changes in static lights, a newly introduced staff held still, capture cancellation and view invalidation, selected LED hues with overexposed cores, and five-second display averages that immediately mask uncertain samples. Native/browser fixtures retain parity.
- Fifteen browser flows pass. The real camera worker rejects a captured white slit while retaining a stationary pink staff, then rejects it with a blue filter. The live UI supports capture, cancellation, clearing, color combinations, and mirror invalidation without freezing the preview. Camera-start retries and persistent occupied-camera errors are covered. Legacy startup-fit settings migrate without changing layout; reset changes only the five guide fields.
- Large-text desktop practice keeps the full preview visible with timing enabled. Fullscreen retains coaching and timing. Hidden correction cues immediately remove instructions referring to them. Slow transitions never superimpose old and new paragraphs. Screenshots use generated imagery only.
- Four Android emulator integration checks pass, covering background capture with continuing frames, sharing, lifecycle and zoom recovery, recording and decoded video, one-staff fitting/streaks, and playback audio. The PC-tempo handoff assertion waits for a frame using the new clock instead of assuming it renders within 300 ms.
- Android lint and debug builds pass. Publication builds and verifies the signed release APK, certificate continuity, alignment, and matching companion archive.

The fixed baseline needs a stationary camera and staves out of view during capture. Identical light overlapping a captured bright region can be suppressed. These checks establish controlled behavior, not ground-truth accuracy or latency for a physical room and staff setup.

# v0.6.0 validation

Validated locally on 2026-10-14.

- 47 JVM and 30 Node tests pass, including a shared native/browser streak oracle. Thirty- and sixty-fps observations earn identical elapsed time and level thresholds. Individual off-guide tips cannot hide inside an acceptable average error; uncertain and missing samples never earn time. Tests cover all scored guide modes, free flow, settings changes, effect disablement, camera gaps, and backward replay.
- Eleven browser flows pass, including reaching level four, target changes resetting the streak, the effects toggle, free-flow behavior, and reduced motion. The generated 60 fps rainbow spin also passes through the real worker and recording path with exported blurred frames explicitly pausing the streak.
- Four Android emulator integration checks pass, including a level-four streak through generated LED images, the native detector, guide fitting, and real preview. The toggle clears earned time; phone metadata contains the streak for the companion. Existing camera recovery, sharing, recording/decoding, timing, and audio checks pass. A cancelled zoom request cannot report an error after entering the demo.
- Android lint and debug builds pass. Publication builds and verifies the signed release APK and companion archive. Updated README screenshots use generated practice rather than private footage.

The effects are cosmetic feedback on the existing projected measurements. They do not increase detection accuracy, turn ambiguous tips into valid scores, or assess overall technique. Live physical-device frame rate and latency have not been benchmarked for the extra effects. The shared model and bounded drawing work run at the existing analysis/preview cadence.

# v0.5.1 validation

Validated locally on 2026-10-14, prioritizing 60 fps phones and capable webcams.

- 41 JVM and 24 Node tests cover bright ends separated by a large dark grip, branched white-window distractors, changing rainbow patterns, exposure sweeps, crossings, angular prediction, uncertain scoring, stable coaching, and camera/exposure/zoom constraint preservation. Native-generated motion fixtures establish browser/native agreement.
- Ten browser flows pass, including a generated 60 fps rainbow spin through the camera, analysis worker, recording, and replay. The native 30 ms analysis throttle is removed as well. This verifies the path, not the maximum sustainable frame rate of every device.
- Four Android emulator integration checks cover lifecycle recovery, sharing, recording with decoded-video verification, playback audio tempo, and one-staff fitting/timing. The native single-staff demo now renders one centered staff.
- Replayed both private sample recordings at their original presentation timestamps and the same 384-pixel analysis scale. The Pixel file contains 1,910 frames and averages 59.49 fps. In its 2–28 second practice section, 1,409 of 1,547 frames (91.1%) retain an observed staff. Across the full clip, only 49 frames meet the precision-confidence gate because most light is visibly smeared. These are coverage/confidence counts, not ground-truth endpoint accuracy. The local desktop run's detector/tracker median was about 1 ms; this excludes camera, conversion, rendering, and streaming costs.
- Visual comparison exposed the old detector repeatedly tracking a window edge. The new luminous-region/pairing path follows the staff in the inspected spin frames. Remaining failures include clipping, heavily merged light, occlusion, and ambiguous ends. Recordings, decoded frames, and private overlays remain outside Git/release assets.
- The C920 file contains 368 frames over 25.75 seconds, about 14.3 fps overall with a roughly 15 fps cadence. It is a fallback stress test, not evidence of 30 fps capture. Requested/reported/live rates and shorter-exposure controls now help distinguish configuration from actual delivery.
- Signed APK continuity, alignment, asset hashes, and CI are checked during publication. README screenshots use generated practice, not the private recordings.

`node scripts/evaluate-video.mjs VIDEO review/analysis.json 1` provides a local replay diagnostic using FFmpeg. The app cannot recover exact instantaneous tip positions from a broad integrated arc. Dashed outlines may use recent geometry and never earn alignment or beat credit. Live Pixel latency, high-end webcam settings, and annotated endpoint accuracy remain unmeasured.

# v0.5.0 validation

Validated locally on 2026-10-14.

- 36 JVM and 15 Node tests cover tempo detection at 60/90/120/174/200 BPM, tempo changes, silence, stale clocks, jittering Android hardware timestamps, PCM-envelope parity, and all prior geometry/tracking/transport behavior.
- Nine browser flows cover local webcam practice, approved-stream processing through the real AudioWorklet/tempo worker, half-speed timing, silence, missing audio-track cleanup, manual fallback, and clock-converted tempo forwarding through the companion relay. The browser audio source is generated and supplied by a test replacement for the sharing picker, not an OS loopback benchmark.
- Four Android emulator integration tests cover the real Android consent dialog and playback-capture service, generated 120 BPM AudioTrack playback reaching the detector, live audio-driven timing, silence, stop behavior, relayed PC tempo, stale-PC expiration, camera recovery, recording/decoding, single-staff fitting, and tutorial assets.
- Hardware timestamp jitter on the emulator initially reversed sample time. Sample-count timing with bounded drift correction fixes the issue and has a regression test. Audio shutdown is synchronized with publishing so stopped capture cannot report itself running again.
- The relay now forwards fit, beat-sync, and audio controls. Queued automatic fitting cannot overwrite newer manual adjustments.
- Lint, debug/release builds, signing continuity, APK alignment, release asset checksums, and GitHub checks are verified for the published source.

Real LED occlusion accuracy, representative music across source apps, physical webcam performance, and Pixel motion-to-display latency still require real use. Android source apps may block playback capture. Browser system/tab audio depends on the OS, browser, selected surface, and audio-sharing choice. Raw audio and screen pixels are neither recorded nor uploaded.

# v0.4.0 validation

- 31 JVM tests and 13 Node tests cover manual tempo, independent early/late and spatial errors, missing-tip suppression, single-staff scoring, uncertain-fit rejection, size fitting, and shared native/browser timing and fit fixtures.
- Browser tests exercise mode-specific tutorial dismissal/reopening, one-staff scoring, tempo changes, live fitting, camera recording/replay, and the existing stream/calibration flows.
- Android emulator integration adds one-staff detection/scoring, timing targets/hits, size fitting, and bundled tutorial checks to existing lifecycle and recording checks.
- Fitting is based on visible staff geometry, not pose recognition or recovered depth. Real practice and capture/display latency need physical validation.

# v0.3.0 validation

Validated locally on 2026-10-14.

- 27 JVM tests and 10 Node tests pass. The native-generated fixture compares LED detection, tracker reacquisition/occlusion, perspective transforms, guide points, correction cues, and nonzero scores against the browser implementation.
- Five browser flows pass: real browser camera capture using generated moving LED frames, measured capture-mode selection, worker tracking, live point selection, mirrored recording, IndexedDB save and decoded playback, camera restart, denied permission, phone streaming/reconnect, demo, and replay. This is controlled fake-camera input, not a real webcam performance benchmark.
- Regression checks keep camera images updating during Identify staves and Calibrate viewing angle. The test suite now isolates its shared relay state, fixing the parallel-test interference seen in v0.2.0 GitHub CI.
- JVM checks preserve calibration/zoom on restored settings. Hidden or shortened tips retain association for up to 1.5 seconds with explicitly low confidence, no precision score, and confirmed reacquisition. Trails last 4.2 seconds and use larger, brighter points.
- Android lint/debug/release builds and emulator camera/recording/lifecycle integration are checked before publishing. Device and real LED practice accuracy remain subject to the limits below.

# v0.2.0 validation

Validated locally on 2026-10-14.

- 24 JVM tests pass, including perspective round trips, skewed grid/circle distances, angle and symmetry invariance, nonzero error preservation, rejected crossed/degenerate corners, missing scores outside calibration, calibration invalidation, directional cue targets, and bounded latest-frame streaming.
- Android 16 emulator integration passes with both emulated cameras: three background/reopen cycles, Activity recreation, automatic camera and enabled-sharing recovery, mirrored rear default, widest zoom, front-camera switching/reopening, code-free local access with browser-origin rejection, binary JPEG decoding, controls, and MP4 recording with saved analysis and decoded-frame verification.
- Seven Node tests pass, including code-free connection, USB transport selection/cleanup, byte-exact binary relay, fragmented packet decoding, bounds, and existing request isolation.
- Three Playwright flows pass, including continuous preview, interrupted-stream reconnection, zoom controls, four-corner calibration, explicit coaching, demo controls, small-screen layout, and analysis replay. No page errors.
- Debug lint/build and release build pass. Demo screenshots from Android and the browser are included in the README.
- The complete Windows ADB-forward / Windows curl / WSL binary stream path passes with the Android emulator: 89 matching JPEG/analysis packets over a four-second sample, about 21.5 fps. USB-style controls pass through the same bridge. This is a controlled emulator result, not physical USB latency. The signed APK is installed on the Pixel with the same signing certificate. A physical USB tunnel is created successfully, but the phone is locked, so live Pixel preview performance remains unverified.

Real LED staff accuracy, performance during fast spins, exact sensor/encoder frame rates, and end-to-end motion-to-display latency still require practice validation. Perspective correction requires manually identifying a rectangle in the movement plane. It cannot correct depth motion or wide-angle lens distortion.

---

# v0.1.0 validation

Validated locally on 2026-10-14. This is an experimental first release; the tests below establish behavior in controlled conditions, not real-practice accuracy.

- 14 JVM tests pass: two glowing staves, crossings, a bright distractor, blank/fully bright frames, duplicate suppression, missing/uncertain measurements, reacquisition evidence, seed behavior, known geometric zeros, portrait/landscape geometry, cube topology, undirected axes, static-motion handling, and invalid remote configuration.
- Debug and release lint/build checks pass. Remaining lint findings concern dependency updates and style suggestions.
- Android 16 x86_64 emulator integration passes: generated LED images run through the real detector, matching JPEG/metrics come from the authenticated phone endpoint, missing credentials are rejected, valid remote configuration is applied, invalid configuration is rejected, CameraX records a real emulator-camera MP4, analysis is saved, and a decoded video frame and duration are verified.
- Four Node transport tests pass: LAN-only addressing, pairing/controls/session export/disconnect, hostile Origin/Host rejection, request boundaries, and redirect refusal without credential forwarding.
- Two Playwright flows pass: demo guides/controls, pairing errors, mobile width, analysis import/replay/scrubbing, and missing-score preservation. No browser page errors. Desktop and mobile screenshots inspected.
- The localhost companion responds successfully from Windows through WSL forwarding.
- The release APK passes Android signature verification and 16 KiB zip alignment. The signing certificate SHA-256 is `9efe3395dc5ddc443e28f5bf0c0391f16da6a329c3813a3e69f7b4d6cf34ac9f`.
- Klobstore v0.1.2 passes its existing 25 JVM tests plus four new catalog-migration checks, lint, and debug/release builds. Its release signing certificate is unchanged.

## Physical test still needed

Caleb chose to finish the release before a live test with his LED staves. Real Pixel capture at 60 fps, LAN latency/throughput between the actual devices, endpoint accuracy during spins, crossings, occlusion, and LED patterns remain unverified. The app reports a requested recording frame rate, not a measured encoder frame rate. Analysis speed is measured independently.

Suggested first check: fixed phone, two fully visible staves, slow parallel rotations, then mirrored rotations, crossing, and deliberate brief occlusion. Check that the outlines follow both staves, confidence drops when a staff disappears, and the overlay matches the image. Adjust the brightness threshold and minimum length before judging the guide measurements. Try the rear camera and PC pairing after the standalone phone view is working.

The native integration test runs only on a disposable emulator. It does not exercise or remove user apps on the physical phone. The physical installation uses the signed release and Android's normal in-place update behavior.
