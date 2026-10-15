# Staff-specific tip training

The first trained helper distinguishes a physical luminous cap from the place where the staff disappears behind the body. EdgeTAM still identifies the staff and supplies its visible mask. When that mask appears shorter than the established apparent length, the helper ranks its two outer boundaries and anchors the inferred staff to the stronger candidate.

This is a small transfer-learning experiment, not a new general-purpose detector or a hidden-tip ground-truth model. It is implemented with [PyTorch transfer learning](https://docs.pytorch.org/tutorials/beginner/transfer_learning_tutorial.html) and the existing [torchvision MobileNetV3 small](https://docs.pytorch.org/vision/0.23/models/generated/torchvision.models.mobilenet_v3_small.html) architecture. No LED-color or brightness rule supplies the decision.

## Model and data

- Frozen ImageNet-pretrained MobileNetV3 small, with a regularized pairwise ranking head and a smaller binary auxiliary loss trained on staff-specific examples.
- One 224 × 224 close crop per candidate, aligned to the staff axis. Training varies crop position, angle, scale, color, and horizontal reflection. Every derivative retains its source recording's group.
- Three private Pixel recordings and existing manually inspected endpoint labels. The selected frames are diagnostic cases and controls, not a random prevalence sample. Some frames were known difficulties before this experiment.
- Visible labels use the outer luminous-cap envelope, with 3–6 pixels of annotation uncertainty at 384 × 216. Hidden ends have no positional label. Ambiguous non-tip boundaries are excluded instead of assigned invented coordinates.
- Boundary labels use conservative annotation-uncertainty bands. Ground-truth-centered positive crops supplement training only; they are excluded from boundary evaluation.
- A fold withholds one entire recording, including all its crops and augmentations. Feature normalization and classifier fitting use only the other recordings. Duplicate source aliases are rejected. Cache fingerprints cover labels, replay boundaries, selected image pixels, recipe, and extraction code.

The helper is used as a **relative ranking**, not a calibrated confidence percentage. On the held-out diagnostic examples it ranked the true cap above the false boundary in all 18 eligible pairs, but five of the 18 false boundaries still received positive binary classifications and three visible caps received negative classifications. That is why it does not decide whether every apparent end is visible. Full masks and empty masks retain the base tracker behavior. There is no new precision score.

An initial two-scale model passed those labeled comparisons but picked the wrong end near a raised hand in an unannotated frame. Visual inspection caught it. Removing the wider context crop and training the pairwise decision corrected that diagnostic case. These recordings informed the architecture choice; their results are diagnostic cross-validation, not an untouched final test set.

## Replay results

Each learned replay uses the model trained without that recording. Baseline and learned runs use the same complete 384 × 216 reference decode, resized to 768 × 432 for EdgeTAM's 512 input, the same initial selection, and the same frame schedule. Errors below are in 384 × 216 annotation pixels and use unordered visible-end matching.

| Recording | Analyzed frames | Base median / P90 | Learned median / P90 | Visible ends within 10 px, base → learned |
| --- | ---: | --- | --- | ---: |
| Original Pixel | 221, every eighth frame plus labels after initialization | 2.29 / 4.31 px | 2.29 / 4.15 px | 19/20 → 20/20 |
| 45-second practice | 2,483, every source frame after initialization | 3.24 / 7.21 px | 3.24 / 7.21 px | 33/33 → 33/33 |
| 2:19 narrated sample | 983, every eighth frame plus labels after initialization | 3.39 / 4.67 px | 3.39 / 4.67 px | 36/36 → 36/36 |

The original-clip wrong-anchor outlier falls from about **84 px to 4 px** on this matched decode. The earlier alpha.1 run decoded the original directly from 4K and measured about 83 px; those decode paths should not be silently mixed. All replays reach the last source frame. The practice replay retains every 60 fps source frame; that does not imply the model executes at 60 fps in real time.

The revised close-crop model also preserves the correct anchor in the raised-hand case that rejected the first candidate. Changed anchor episodes were inspected visually in addition to checking the existing annotations. None of these results measure the accuracy of invisible endpoints or prove every unannotated frame is correct.

## Reproduction

Private examples, frames, reference decodes, predictions, and checkpoints belong under an ignored `review/` directory or outside the checkout. Do not upload them. Normal app setup installs EdgeTAM; the ImageNet training weights are downloaded only by an explicit training run.

Create a private manifest pointing to the existing annotation schema and completed replay outputs:

```json
{
  "labels": "/local/private/labels.json",
  "replays": {
    "recording-a": "/local/private/replay-a.json",
    "recording-b": "/local/private/replay-b.json",
    "recording-c": "/local/private/replay-c.json"
  }
}
```

The label file has `width`, `height`, a `clips` map with each recording's `video` and complete BGRA reference `cache`, and a `frames` list. Each frame has `clip`, source `index`, and two unordered `ends`. Each end has `visibility` (`visible`, `hidden`, `clipped`, or `ambiguous`), `point` (pixels, or null), and `uncertainty_px` (or null). A reference cache is contiguous `[frame, height, width, 4]` uint8 BGRA in source presentation order. Replay outputs come from `motion.evaluate` and retain `visibleExtent`, `ends`, and source frame indices. Incomplete replays are rejected.

```sh
.venv-motion/bin/python -m motion.training.train \
  --manifest review/private-manifest.json \
  --output review/staff-tip-experiment
```

The default recipe uses 48 variants, fixed seed 20261015, frozen features, pairwise logistic loss plus a 0.25-weight balanced binary loss, and L2 penalty 0.01. The command produces one checkpoint per withheld recording, a separate all-recording fit, feature-cache provenance, and a JSON report. The all-recording fit has no held-out score of its own.

Replay a withheld recording with its corresponding `holdout-<recording>.pt` checkpoint, using `motion.evaluate --tip-checkpoint`. Use the same source decode, initial selection, frame schedule, and geometry for baseline and learned runs. Positional error must be matched to visible annotations without assuming persistent physical end identity. Hidden-end error cannot be measured from these labels.

## Local activation

Only load checkpoints you created or trust. A checkpoint contains the complete backbone and head, so runtime loading works offline:

```sh
KLOBFLOW_TIP_CHECKPOINT=/local/private/all-recordings.pt ./motion/run.sh
```

The service reports `EdgeTAM + staff tip model` when active. An invalid checkpoint produces a startup error rather than silently falling back. Without this setting, the published app uses base EdgeTAM. Private trained weights are deliberately absent from the APK, source archive, and GitHub assets. On Caleb's development machine the local service is configured with the trained helper after validation.

## Limits

These are recording-level holdouts within one practitioner's existing material, not an independent benchmark across people, backgrounds, props, or camera systems. Three videos and a few dozen annotated frames do not establish broad generalization. Long occlusions, fast reversals, missed masks, reflection pickup, foreshortening, and physical tip identity can still be ambiguous. The midpoint is inferred whenever an end is inferred. Neither circularity nor technique scoring is part of this milestone.

A larger visibility/keypoint model needs more independent annotations, especially true caps against clothing, both ends hidden, motion cones, reflections, and changes of room/camera. This experiment keeps the useful ranking improvement without turning unreliable absolute classifier outputs into measurement claims.
