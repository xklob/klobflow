Clearer tracking during normal practice

- Recover a saturated blue or rainbow shaft connecting brighter white caps. A dimmer body no longer automatically turns visible endpoints into a blur rejection. Clipped outer glow is accepted only when the actual bright caps remain fully visible.
- A brief rejected exposure no longer forces an already confirmed staff to reconfirm on the next clear frame. Missing tips, ambiguous identity and extended blur still require fresh evidence; hidden or predicted endpoints never count as measurements.
- Replace persistent motion-blur warnings with separate five-second summaries: the percentage of frames measured, and the percentage of measured frames with every tip on target. Brief behind-the-back occlusion preserves recent feedback and association; a faded outline is labeled LAST SEEN. Current scores and correction rings still pause on uncertain frames.
- Increase Target tolerance from 1–15% to 1–50% on Android and the web. The percentage is distance from the guide divided by guide width, or circle diameter.
- Explain beat practice in both interfaces and label the timed endpoint BEAT TIP. Timing (within ±75 ms) and position (within Target tolerance) are named separately.
- Color trails by age: cyan for newest segments, through blue/violet to pink for older segments, fading over 4.2 seconds.

Validation used both private Pixel recordings, including the newly supplied 44.73-second, approximately 60 fps session with its saved one-staff circles settings. Replaying the same 2,661 video frames increases measured-endpoint coverage from 1,864 (70.0%) in v0.7.0 to 2,161 (81.2%); observed tracking remains 2,469 frames. The original Pixel clip improves from 544 to 656 measured frames out of 1,910. Android and browser agree on all 4,571 replayed frames. Coverage is not independently annotated accuracy or an on-target technique grade. Private recordings and images are not included.

JVM, Node, browser, Android emulator, lint, signed build, and publication checks are recorded in docs/validation.md. Android and browser share the behavior above. Update the APK through Klobstore or this release, update the companion files, and refresh the browser. Package and signing identity are unchanged; versionCode is 10.
