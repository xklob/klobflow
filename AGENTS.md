# Klobflow

Native Kotlin/Compose Android double-staff practice app with a localhost Node companion. The phone owns camera capture, detection, metrics, and recording. Keep video and practice data local.

- Track unmarked LED staves. Never require tape or claim markerless identity survives complete occlusion.
- All scores are projected 2D measurements, not recovered 3D depth or a universal assessment of technique. Missing/ambiguous tracking must not produce a valid score.
- Keep image, coordinates, mirroring, and overlay transforms consistent. Preserve timestamps, confidence, and missing samples in exports.
- Every major feature/update needs a new commit, versionCode increase, signed APK, and published GitHub release with the matching source commit, checksum, and release notes.
- Release key is external: `KLOBFLOW_SIGNING_PROPERTIES`. Never commit signing material or pairing secrets. Use the same certificate for every release.
- Validate with `./gradlew testDebugUnitTest lintDebug assembleDebug` and `node --test companion/test/*.test.mjs`; run device checks for camera/recording changes. State physical-camera verification limits honestly.
- Companion runs locally. Do not publish private practice recordings or enable a cloud dependency.
