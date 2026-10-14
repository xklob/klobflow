# Endpoint quality follow-up

This continues the post-v0.8.0 review. The aim is to reduce falsely precise measurements when a staff passes behind the body or its white light merges with the background. The changes apply to the shared Android and browser behavior. They do not extrapolate invisible endpoints or award precision for predicted motion.

## Body occlusion

A visible piece of shaft can end at a shirt or body boundary. Its bright edge resembles an end cap, and a frame-to-frame length check can gradually learn the shortened piece as a full staff.

The additional scoring check keeps an independent, four-second history of accepted lengths and bright-cap appearance. It acts only after repeated observations establish two bright caps. Shortening must coincide with a substantial loss of one learned cap before the measurement becomes uncertain. Length alone cannot reject a staff tilted toward the camera. Current observed coordinates and the motion predictor remain unchanged.

Once triggered, the check waits for two consecutive clear cap observations before restoring precision. Missing frames interrupt that recovery. Camera resets, expired identities, clock discontinuities, and staff-count changes clear the learned state. Staves without established bright caps do not acquire a universal white-cap requirement.

## Selected LED colors and white shafts

Color filtering can remove a white shaft that touches a large sunlit region even when the distant colored cap remains visible. Flooding that white region would also admit background light. The alternative checks fresh, sharper geometry in the image before color filtering, while requiring selected-color evidence around both candidate ends.

Recovery is restricted to a modest, aligned extension that retains one endpoint and covers the existing segment. Both ends must have selected hue on both sides of the staff axis; a small reflection on only one side is insufficient. An additional detector pass is conditional, and cannot recurse indefinitely. Initial discovery keeps the user's brightness threshold; the extra pass uses threshold 250 to seek sharper bright geometry. Recovered coordinates come from current image pixels, with reduced confidence. White-only selection does not enable this hue-based recovery.

If otherwise supported geometry contradicts the shortened segment but an endpoint neighborhood reaches the image edge, the original segment becomes uncertain. Its coordinates remain unchanged, and it is not falsely labeled as motion blur. Neither the shortened segment nor a guessed extension can earn precision.

## Evaluation method

The private evaluation uses all three Pixel recordings in timestamp order, including the narrated sample. Tracker history is never restarted at a labeled frame. The analysis image is 384×216; endpoint error is measured in those pixels, not physical distance.

One diagnostic set contains 46 manually labeled frames: 25 with both ends visible, 20 with a hidden or clipped end, and one ambiguous exposure. A separate set contains 16 frames selected and labeled before examining the candidate's predictions: 10 fully visible, four clipped, and two broad blurred exposures. These are selected frames from the same recordings, not a representative sample of new practice sessions. Labels have approximately 3–6 pixels of uncertainty. Invisible ends have no invented coordinate.

Three quantities are kept separate: whether the app emits a precise reading, whether an emitted endpoint agrees with its visible label, and whether a hidden or clipped end incorrectly receives precision. Higher reading availability by itself is not better tracking.

## Results

The baseline is review commit `95a37d1`. The table combines the two label sets: 35 fully visible frames, 24 with a definitely hidden or clipped end, and three ambiguous exposures. Only the narrated recording's configuration changes between rows; the original Pixel clip retains threshold 175 and the recent practice clip retains threshold 250.

| Narrated setting | False precise readings on 24 hidden/clipped frames, before → after | Precise readings on 35 visible frames, before → after | Visible readings with both endpoints within 6 px, before → after |
| --- | ---: | ---: | ---: |
| Any/rainbow, threshold 175 | 13 → 3 | 20 → 20 | 18 → 18 |
| Any/rainbow, threshold 250 | 14 → 4 | 31 → 31 | 29 → 29 |
| Pink/purple, threshold 175 | 14 → 4 | 30 → 29 | 25 → 27 |
| Pink/purple, threshold 250 | 15 → 5 | 29 → 28 | 24 → 26 |

No ambiguous exposure becomes precise. Every previously precise visible reading within the six-pixel bound is retained in this selected set. The one removed visible reading under color filtering had approximately 44 pixels of endpoint error; it now correctly withholds a measurement it cannot support. In the separate 16-frame set, visible reading availability is unchanged under all four settings. With colors selected, the previously 38.64-pixel endpoint error at 108.496 seconds becomes 1.87 pixels. The diagnostic 24-second example improves from 43.22 to 5.83 pixels using the frozen labels.

Complete replay still loses measured frames: the original clip changes from 656 to 632, the recent practice clip from 2,161 to 1,876, and the narrated clip with Any/rainbow at threshold 250 from 5,204 to 5,087. Removing false precision accounts for part of that reduction, but not every withheld frame has been labeled. Some visible frames also remain uncertain during cap recovery. Complete counts and native/browser agreement are recorded in [validation](validation.md).

## Remaining limits

Early occlusion can still resemble a complete staff before a reliable appearance and length history exists. A reflection can also look like a physical cap. The original clip's reflected endpoint at 21.619 seconds remains a false precise reading, with 24.58 pixels of endpoint error. A trial bright-core trimming correction fixed that frame but incorrectly shortened real saturated red, blue, and pink ends in controlled images. A conservative continuation check also rejected the desired correction, so that approach is excluded.

Further bounded checks confirmed that neither recent length nor a narrow contrast check makes that trimming safe. Nine controlled red, blue, and pink sequences add a real 24-pixel illuminated section, which the current tracker correctly measures. White-core trimming incorrectly removes it in every sequence and matches the previous length exactly. A contrast safeguard protects narrow tips but still removes six wider colored bulbs. These are regressions from existing correct behavior, so no reflection-trimming rule is included.

Counting the tracker's confirmation frames toward cap restoration also failed independent frame inspection. It restores visible ends near 131.7 seconds in the narrated recording, but admits an end still hidden by the shirt at 12.944 seconds in the recent practice recording and a clipped end near 106.50 seconds in the narrated recording. Those additional counterexamples are preserved privately without changing the earlier labels. Requiring paired caps before length learning or tightening the shortening threshold did not resolve the early occlusions and withheld other readings. These history variants are excluded; improving endpoint visibility evidence is the next useful investigation.

A selected-color clipping experiment followed an uninterrupted bright shaft from an apparent interior endpoint to the image boundary. It corrected the clipped reading at 84.995 seconds, but broader frame inspection exposed visible caps against bright tapestry and an ambiguous endpoint newly admitted after the change affected tracking history. It is also excluded. The final bounded follow-up leaves detector decisions unchanged and adds configurable streak forgiveness instead: brief interruptions retain earned progress without relaxing endpoint precision or awarding unseen time. Further tracking experiments are paused for live testing.

Colored patterns, exposure changes, clipping, and motion blur can leave a valid movement unmeasured. The learned guard can delay recovery on genuinely visible ends, including inspected frames around 131.7 seconds in the narrated recording. These checks reduce specific demonstrated failures; they do not establish semantic object identity or recover arbitrary hidden motion from one camera.

Recordings, audio transcripts, frame images, manual labels, and detailed replay reports remain local. See [validation](validation.md) for final test and replay results and [the broader review](review-2026-10-14.md) for the framework decision.
