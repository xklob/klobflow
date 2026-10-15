# Klobflow

This experimental branch is a fresh descriptive-motion rewrite. `motion/` runs a local learned vision model and browser UI; `motion-phone/` is a new Android camera source. The current prototype processes frames on the PC. On-phone inference is a follow-up and must not be claimed complete. The previous Android app and Node companion remain in `app/` and `companion/`; only their camera and transport primitives are reused. Keep video and practice data local.

- Track unmarked LED staves. Never require tape or claim markerless identity survives complete occlusion.
- All scores are projected 2D measurements, not recovered 3D depth or a universal assessment of technique. Missing/ambiguous tracking must not produce a valid score.
- Keep image, coordinates, mirroring, and overlay transforms consistent. Preserve timestamps, confidence, and missing samples in exports.
- Every major feature/update needs a new commit, versionCode increase, signed APK, and published GitHub release with the matching source commit, checksum, and release notes.
- Rewrite milestones are opt-in prereleases. Do not replace the latest stable release or merge this branch merely to publish a prototype.
- Release key is external: `KLOBFLOW_SIGNING_PROPERTIES`. Never commit signing material or pairing secrets. Use the same certificate for every release.
- Validate with `./gradlew testDebugUnitTest lintDebug assembleDebug` and `node --test companion/test/*.test.mjs`; run device checks for camera/recording changes. State physical-camera verification limits honestly.
- Also run `python -m pytest motion/tests` in the motion environment and the Playwright suite in `motion/playwright.config.mjs`. Replay the private Pixel samples with the learned model. Synthetic UI tests prove wiring, not detection accuracy; incomplete video decodes must not count as full replays.
- Describe probable ends, midpoint and paths. Do not reintroduce fixed targets or technique scores. Clearly distinguish mask-boundary estimates from motion/length inference. Network foreground probability is not calibrated endpoint accuracy.
- Companion runs locally. Do not publish private practice recordings or enable a cloud dependency.
