Visible glow endpoints and focused practice

- Recover the two visible caps from the bright staff body inside a wider colored glow. Separate the connected shaft sections from detached bright reflections before locating the ends. This works across a dark grip without requiring markers or a fixed LED color.
- Remove the extra 650 ms precision pause after the tracker has already confirmed clear ends. Current rings and five-second error averages resume on valid observations; text still holds and fades slowly. Hidden ends, clipped tips, ambiguous shapes and broad exposure fans remain unscored.

The complete Pixel recording was replayed at its original timestamps through both engines. Android and browser results agree on all 1,910 frames. Clear-end measurements increase from 49 to 544 frames while observed tracking remains at 1,509 frames. In the 2–28 second practice section, tracking remains at 91.1% and 538 of 1,547 frames support precision feedback. These are coverage/confidence counts, not a ground-truth accuracy claim. Recovered ends were also inspected against the visible glow; heavy blur and occlusion still limit precision.

- Android gains a full-screen practice view with recording, tracking/alignment status, beat feedback, streaks, and a visible exit. Landscape places feedback beside the camera. Capture continues when entering and leaving the view.
- Browser fullscreen has visible Record and Exit full screen buttons. Large-screen feedback uses the available width to give the video more room.
- Auto-fit and a five-second background capture shortcut sit beside the preview in both versions. Android's Setup section groups LED colors, background controls, and guide fitting. The browser's LED colors & lights shortcut goes straight to the detection settings.
- Fitting controls appear before the longer tutorial. Browser tutorials initially show one step and expand on request. Both versions keep the line/ring explanations behind a clearly labeled control.
- Fix a sticky sidebar covering detection controls after scrolling at narrower desktop widths. Large text and timing feedback keep the complete desktop preview on screen.

This follows v0.6.1's background filtering, color detection, clearer correction cues, smoother trails, manual fitting, and five-second error averages. Recording, calibration, audio, and replay features remain available.

Validated with JVM and Node tests, browser camera/recording flows, and Android emulator checks including portrait/landscape practice. README screenshots use generated practice. Real staff accuracy and physical-device latency still depend on camera, lighting, and motion blur.

Install the signed APK through Klobstore or this release. Klobflow is already in Klobstore's bundled catalog; refresh its releases to see the update. The companion ZIP also runs standalone with a PC camera. Refresh the browser after updating.
