Alignment streaks and evolving flow effects

- Sustain alignment to build brighter tip halos, larger trails, orbiting particles, and gold rings. Levels advance at 2, 5, and 10 seconds, with a timer, power bar, and best streak in the practice view.
- Available on native Android, the phone's USB/LAN companion, and standalone browser-camera practice. Works with one or two staves across Grid, Circles, and Cube. Free flow keeps decorative trails without an alignment streak.
- Every tip must meet tolerance. An off-guide tip ends the streak; unclear tracking pauses credit and ends the streak after 350 ms. Camera interruptions and guide adjustments cannot earn time. Precision and timing scores remain unchanged.
- Toggle the extra effects off independently of ordinary trails. Reduced-motion preferences stop particle rotation. Saved analysis includes the streak for replay.
- Keep the native streak panel below the camera so it cannot cover tips. Ignore cancelled zoom callbacks after changing camera sessions or entering the demo.
- Includes all v0.5.1 high-frame-rate tracking, rainbow LED, exposure, and readable-coaching improvements.

Validation: 47 JVM tests, 30 Node tests, 11 browser flows, Android lint/builds, and four emulator integration checks. Tests compare native/browser streak calculations, 30/60 fps timing, uncertainty, all-tip adherence, effect controls, and exported state. Screenshots show generated practice. Real device capture performance and endpoint accuracy retain the limits documented in the README.

Install the signed APK in place or update through Klobstore. Extract the companion ZIP and run `node server.mjs`, then open http://localhost:8788. Refresh existing browser tabs to load the new effects.
