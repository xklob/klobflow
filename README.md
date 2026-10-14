# Klobflow

A native Android practice tool for double staves, with a local PC companion. Track unmarked LED staves, lay out a front-facing grid, overlapping circles, or a projected cube, and inspect your practice in real time.

**First release: experimental markerless tracking.** Camera recording and the full analysis pipeline are tested on an Android emulator and generated LED images. Accuracy with real LED staves, motion blur, occlusion, and Pixel 60 fps capture still needs physical practice validation. This is a measurement aid, not a universal technique grade.

## Install

Get the signed universal APK from [GitHub Releases](https://github.com/xklob/klobflow/releases/latest). Android 10 or newer is required. Package: `com.caleb.klobflow`.

Klobflow is bundled in [klobstore v0.1.2+](https://github.com/xklob/klobstore/releases/latest). Update klobstore to add it to an existing catalog, then install/update it there. You can also add `xklob/klobflow` manually. Updates preserve the app's package and signing identity and increase Android `versionCode`.

## First practice

1. Put your phone on a stable support. Keep both staves and their full movement in frame. Use the selfie camera alone, or the rear camera with the PC companion.
2. Turn on the LED staves. The default detector looks for bright, narrow shapes without markers. Adjust brightness threshold and minimum staff length in **Adjust**. A contrasting background helps.
3. Choose **Grid**, **Circles**, **Cube**, or **Free**. Calibrate position, size, rotation, circle separation, and cube projection depth to your practice area. The guide stays fixed in the image; it does not automatically follow your body.
4. Automatic detection starts with the strongest elongated shapes. If it chooses incorrectly, hold still and use **Identify staves** to tap both ends of staff A, then both ends of staff B. **Reacquire** clears tracking history.
5. Start slowly. Stave outlines show tracking; low confidence pauses the scores. Trails show recent tip motion.
6. **Record practice** saves a silent MP4 to `Movies/Klobflow` and per-frame analysis privately in the app. **Sessions** plays the video or exports the JSONL measurements. The overlay is live and is **not burned into the MP4**.

Camera capture requests 1080p at 60 fps, with 720p/30 fps fallback if binding fails. CameraX treats frame rate as a target, not a guarantee. Analysis/display run independently at up to approximately 30 fps; PC previews are capped at approximately 10 fps. A higher video frame rate does not eliminate motion blur. Camera hardware, exposure, and processing load affect the actual rates.

## PC companion

The companion uses Node 22+ and has no runtime package dependencies:

```sh
cd companion
npm start
```

Open **http://localhost:8788**. On the phone, enable **PC sharing** and keep Klobflow in the foreground. Enter its displayed IPv4 address and pairing code on the PC. Both devices need LAN connectivity; guest Wi-Fi client isolation can block this. The phone listens on TCP 8787. The PC server listens only on loopback.

On Caleb's WSL machine, `./scripts/start-companion.sh` starts the local service if necessary. Windows can access the same localhost URL. The initial setup runs it as a user service without enabling startup at boot.

The phone performs all real camera processing, detection, tracking, and scoring. The PC relays the preview and controls, draws the phone's geometry, shows a 30-second error chart, and can review/export saved analysis. No video is sent to an external service. Sharing is explicit and uses a fresh 64-bit token each time; it stops when the app leaves the foreground. Traffic is plain HTTP on your LAN, so use a trusted network. The pairing code stays in the local server's memory and is never placed in URLs or browser storage.

Use **Explore a demo** to inspect the interface without a phone. That preview is visibly labeled as generated motion. The native Android demo runs generated LED frames through the real detector. Neither is evidence of real-world tracking accuracy.

## What the numbers mean

All coordinates use square-pixel image geometry, normalized by the shorter image dimension. All distance errors use the guide's front-square width (or circle diameter) as the denominator.

| Measurement | Definition |
| --- | --- |
| Grid error | RMS distance of the four tips to the nearest selected grid line segment, as a percent of guide width. |
| Circle error | RMS tip distance to the nearest circle circumference, as a percent of diameter. |
| Cube vertex error | RMS distance of tips to the nearest projected cube vertex, as a percent of front-square width. Use for alignment snapshots. |
| Angle error | Mean undirected staff-axis angle to the nearest guide-line orientation, in degrees. |
| Mirror symmetry | RMS mismatch after reflecting one staff across the guide's rotated center axis, with endpoint order minimized. Only meaningful for mirror-symmetry drills. |
| Speed variation | Coefficient of variation of mean absolute angular speed over the last 1.2 seconds. Requires enough continuously tracked motion; stalls and transitions can increase it. |
| Tracking coverage | Fraction of recent analyzed frames with two sufficiently confident staff detections. |

Lower error means closer adherence to the selected reference. **Tolerance** sets the visual target band for the error history; it does not change measured error. Missing/ambiguous detections produce null scores, not perfect scores. Partial staves and rapid movement can produce inaccurate endpoints even when the detector is confident. Confidence is a geometric heuristic, not a calibrated probability.

A single RGB camera does not recover dependable depth. The cube is a projected reference. The app does not measure out-of-plane movement, automatically classify tricks, or infer hand/arm positions. Identical ends are undirected axes; prop identities and end identities may swap after occlusion. VTG timing/direction and ratio selections are session annotations, not inferred phase or flower classification.

## References

- [Noel Yee: Vulcan Tech Gospel](https://noelyee.com/instruction/vulcan-tech-gospel/) informs the separation of timing/direction, snapshots, and patterns. We use Together/Split followed by Same/Opposite and annotate 1:1, 1:3, and 1:5 drills.
- [VTG reference poster hosted by Flow Arts Institute](https://flowartsinstitute.com/wp-content/uploads/2015/02/VTGpostersmall.jpg) is linked in both interfaces. The poster is not redistributed in the app.
- [DrexFactor: VTG explained, hosted by Noel Yee](https://noelyee.com/drexfactor-vulcan-tech-gospel-explained/) provides further instruction.

Klobflow is independent and not endorsed by those creators. Original diagrams, illustrations, and lesson content remain with their creators.

## Development and releases

```sh
./gradlew testDebugUnitTest lintDebug assembleDebug
node --test companion/test/*.test.mjs
cd companion
npm ci
npx playwright install chromium
npx playwright test
```

Camera/sharing/recording integration tests live under `app/src/androidTest`. Run them on a disposable emulator; they grant the app camera access and save a short test video. They never remove installed user apps. Use `scripts/run-device-tests.py --adb /path/to/adb --serial emulator-5554` after building debug and test APKs. `--windows-stage` supports Windows adb from WSL.

The release key lives outside the repository, configured with `KLOBFLOW_SIGNING_PROPERTIES`. Keep the same key forever. For each major feature or update: bump `versionCode` and `versionName`, run validation, commit the source, then run `scripts/release.sh VERSION NOTES_FILE`. The script builds, verifies the APK, packages the companion, tags/pushes the source, and publishes a GitHub release with SHA-256 checksums. No signing secrets belong in Git or GitHub assets.

See [architecture](docs/architecture.md) and [validation](docs/validation.md) for implementation details and verification limits.
