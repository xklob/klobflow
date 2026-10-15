Tracking recovery, forgiving streaks, and clearer audio feedback

- Improve endpoint checks when a staff passes behind the body or overlaps reflected light. Recover supported white caps inside colored halos, reset stale tracking history, and keep uncertain ends from earning precision or beat credit.
- Add Tracking grace (0–3 seconds, default 1.5 seconds) and Alignment grace (0–1 second, default 200 ms). Brief interruptions preserve earned streak progress with STREAK HELD; they add no time or effects and do not change measured scores.
- Show incoming sound, beat confidence, collection progress, and possible tempo on Android and web. After three continuous seconds of stable beat detection, retain BPM, phase, and confidence through dropouts for up to 15 seconds. Holding tempo shows a countdown while input volume stays live. Stopping audio, manual mode, or stale capture data clears the hold.
- Cycle the leading trail hue through the entire rainbow every 4.2 seconds. Each older mark keeps its color as it fades.
- Keep the visible audio section in view when switching to Large text and add an Audio & beat shortcut. Render sharper browser overlays and clearer mobile fullscreen feedback.
- Improve camera recovery, recording/export after interruptions, and settings edits made while an earlier change is still being applied.

Validation includes 102 regular JVM tests, 87 Node tests, 33 browser flows, Android lint/builds, and an Android emulator playback-capture test covering the complete beat hold and expiry. Native/browser replay agrees across 29,495 frame/configuration cases from the three private Pixel recordings, including the narrated sample. Private recordings and derived images are excluded from the release.

Some early occlusions and reflections can still produce incorrect endpoint readings, and conservative checks can delay recovery. These results are not a claim of perfect tracking or measured physical-camera latency. Further detector experiments are paused for live practice feedback. Details are in docs/validation.md and docs/endpoint-quality-review.md.

The signed APK keeps package com.caleb.klobflow and its existing signing identity, with versionCode 12. Update through Klobstore or install the APK from this release. The companion ZIP supports both browser-only practice and Android streaming; update it and refresh the browser. No phone is needed for browser-only practice.
