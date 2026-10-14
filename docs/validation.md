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
