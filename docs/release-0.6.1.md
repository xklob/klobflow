Clearer practice feedback and room-light filtering

- Capture a fixed background after a five-second countdown to exclude static lamps and sunlight. The preview keeps playing; holding a new staff still afterward does not erase it. Clear or recapture the baseline as needed.
- Select one or several LED colors to reject other lights, or keep Any / rainbow. Selected hues retain nearby washed-out white LED cores. White alone cannot distinguish sunlight from a white staff.
- Separate tracking, alignment, and timing into stable panels, with slow text transitions and larger desktop body/helper text. Strongly outlined tip rings, arrows, and labelled TARGET rings make corrections visible. Green/lime and purple staff lines identify the props; they are not alignment scores.
- Stop referring to correction arrows when they are hidden or all tips are already within tolerance. Clarify minimum staff length as apparent end-to-end length, in percent of the camera image's shorter edge.
- Connect tip trails into clean lines with subtle detection highlights. Missing observations and large jumps break the trail.
- Start Auto-fit only when you choose it. Reopening preserves layout and zoom. Reset guide layout changes only center X/Y, size, rotation, and circle separation.
- Display alignment, angle, and symmetry errors as five-second rolling averages. Uncertain tracking pauses values immediately; raw measurements still drive scores, streaks, and exports.
- Retry compatible PC-camera startup modes after transient source failures, release capture promptly, and explain how to recover when the webcam remains occupied.

Both native Android and browser-only practice support these controls; the companion controls the phone's detector when connected. Background capture needs a fixed camera and an empty practice area. Capture again after the view or lighting changes. An LED directly overlapping an identical background light can also be suppressed.

Validation: 54 JVM tests, 39 Node tests, 15 browser flows, Android lint/build checks, and four Android emulator integration checks. The emulator exercises camera recovery, recording, background capture, timing, and playback audio. README screenshots use generated practice. Physical LED accuracy and end-to-end latency remain subject to testing with your setup.

Install/update the signed APK through Klobstore or the APK below. The companion archive includes the standalone PC-camera web app. Existing localhost users should refresh the page after updating.
