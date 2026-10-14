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
