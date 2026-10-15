Follow moving guide dots in Circles and Antispin

- Add an interactive Follow moving dots exercise on Android, the phone companion, and browser-only PC-camera practice. Match both staff ends to the blue moving targets. Circles use opposite dots on each circle; Antispin uses a horizontal and vertical target that stay one staff length apart.
- Configure speed from 5 to 120 cycles per minute, direction, countdown, and dot size. Two-circle practice also supports second-staff direction and phase offset. Existing guide size, center, rotation, separation, perspective calibration, and tolerance controls apply.
- Start manually when ready. Pause freezes the target phase; Resume includes the countdown; Restart resets phase; Stop returns to ready. Camera interruptions and setup changes require a new start. An old queued camera frame cannot undo a newly issued command.
- Show five-second following percentage, average tip-to-dot gap, and measured tracking coverage. Streaks now require following the moving dots while this exercise is enabled. Hidden or ambiguous tips cannot score; ordinary practice and short tracking/alignment grace remain available.
- Keep targets visible through ordinary detection misses, with distinct blue target disks and measured tip markers. Fixed beat targets are hidden during this exercise so the cues stay clear; audio controls remain available. Dot speed is independent of music BPM. Large text, mobile layouts, fullscreen, and reduced-motion preferences are supported.

Validation and publication checks are recorded in docs/validation.md. Pixel recording regressions compare the unchanged detector, geometric metrics, and ordinary streak behavior with v0.10.0. The exercise's moving targets and timing are tested with controlled motion; the private recordings were not attempts to follow this new exercise.

The signed APK retains package com.caleb.klobflow and the existing signing certificate, with versionCode 14. Update through Klobstore or install the APK from this release. Update the companion ZIP and refresh the browser for matching controls and browser-only practice.
