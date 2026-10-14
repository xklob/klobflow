LED spin tracking and clearer practice feedback

- Follow bright LED ends across a dark grip and changing rainbow colors. Broad motion blur keeps an approximate dashed outline with precision paused. Improve angular association and recover from uncertain tracks without holding a stale guess indefinitely.
- Prioritize high-frame-rate practice: remove fixed 30 fps analysis throttles on Android and browser, preserve capture mode when zoom changes, and negotiate supported resolution/rate combinations explicitly.
- Separate requested, camera-reported, delivered, and analyzed frame rates. Add browser shutter controls when supported, including 1/120, 1/240, and 1/500 second requests.
- Replace flashing coaching text and unexplained notation with stable guidance, ON GUIDE labels, MOVE arrows, white target bullseyes, and a visible legend. Keep stronger trails at high analysis rates.
- Refresh screenshots and add a local video diagnostic. Fix the native one-staff demo to show one centered staff.

Validation: 41 JVM tests, 24 Node tests, ten browser flows including a 60 fps rainbow camera, Android lint/builds, and four emulator integration checks. Replayed the supplied Pixel and C920 recordings privately. The Pixel's main practice section retains observed tracking on 91.1% of frames; this is detection coverage, not endpoint accuracy. Most broad blur remains unscored. The C920 recording itself is approximately 15 fps.

Install the signed APK in place or update through Klobstore. Extract the companion ZIP and run `node server.mjs`, then open http://localhost:8788. Refresh existing browser tabs and recheck capture modes. Physical device capture rate, shutter availability, and end-to-end latency still depend on hardware and lighting.
