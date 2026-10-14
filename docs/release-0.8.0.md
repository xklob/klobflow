One-staff linear antispin practice

- Add Antispin on Android, the phone companion and browser-only practice. One tip follows a labeled horizontal line and the other follows a vertical line. Each tip gets its own axis, correction target and five-second drift reading. Shaft angle is not penalized.
- Automatically select one staff. Match staff length sets center-to-edge distance to one full staff length. Manual Auto-fit estimates the cross center from the movement envelope. Existing rotation and viewing-angle calibration remain available.
- Add a dismissible setup tutorial, a generated antispin demo, and Android/web screenshots in the README. Continuous trails, tolerance up to 50%, background/color filtering and streak effects work with the new guide.
- Beat practice follows four outer turnarounds, alternating tips. The interface explains the difference from circle timing and how to follow a pulse. Turnaround timing is estimated from the combined tip cycle; position is scored separately.

Validation includes native/browser agreement across 324 generated antispin frames, both rotation directions, swapped endpoints, perspective correction, missing/blurred observations, off-axis errors, size fitting and early/late beats. Both existing private Pixel recordings are replayed as tracking regressions. This release does not claim physically annotated antispin accuracy; the supplied recordings are not treated as ground truth for the new exercise.

The signed APK retains package com.caleb.klobflow and the existing signing identity, with versionCode 11. Install/update through Klobstore or this release. Update the companion and refresh the browser to use the new mode with an updated Android app. Detailed checks are in docs/validation.md.
