# Vision framework review

Reviewed 2026-10-14 against v0.8.0, commit `778978ea7b218dc16e3246a445bbba96ada992d7`.

## Decision

Keep the current detector for this change. Use OpenCV as a comparison implementation and a possible future processing backend, but do not add it to the shipped app merely to replace connected components. The tested replacement preserved the existing decisions and was slightly slower in the desktop browser. It did not recover additional endpoints.

The current code already uses established algorithms: thresholding, eight-connected components, weighted principal-axis fitting, Hough voting and temporal association. The specialized work is deciding which luminous pieces belong to a staff, pairing them across a grip, separating a shaft from its glow, and deciding whether both ends are actually visible. A library supplies useful primitives; it does not supply these decisions.

The highest priority is better evidence at the endpoint and candidate-selection boundaries. Predictions can maintain an approximate outline through occlusion, but cannot establish a precise hidden endpoint or earn alignment credit. Keep the same rule on Android and in browser-camera mode.

## Bounded comparison

Private recordings remained local. No frames, audio, transcript, derived contact sheets or recordings are included in this document or committed as fixtures.

The experiment used 21 selected 384×216 frames from three recordings, including visible shafts, broad glow, partial occlusion and clipping. Each frame was tested with one staff under two configurations: threshold 175/minimum length 0.22, and threshold 250/minimum length 0.36. These are diagnostic samples, not a random or held-out accuracy benchmark. Detection started without tracking hints for this frame comparison.

An isolated OpenCV.js 4.13.0 adapter replaced the connected-component traversal in `ledRegions` and `motionCandidates`. The mask, weighting, pairing, candidate ranking, endpoint checks and tracker code were retained. The adapter reused its OpenCV matrices, copied the mask into WebAssembly, read the component labels back, and restored raster ordering before describing components.

Across all 42 cases, candidate counts, confidence and blur flags matched. The maximum normalized-coordinate difference was `2.61e-16`, consistent with floating-point summation order. This comparison establishes equivalent sample behavior, not correctness against real endpoints.

A further sequential replay exercised tracking hints and dim-motion recovery on 4,571 frames from two complete clips. Both backends produced identical candidate counts, track presence, confidence, blur and occlusion flags throughout. The largest coordinate difference was `3.89e-15`. Mean Node detector-plus-tracker time was 1.45 versus 1.65 ms on the first clip, and 0.79 versus 1.03 ms on the second. These are behavioral parity results, not endpoint ground truth.

| Desktop runtime | Existing detector, mean per call | OpenCV component adapter, mean per call |
| --- | ---: | ---: |
| Node 24.18 | 0.99 ms | 1.24 ms |
| Headless Chromium 153 | 0.93 ms | 1.15 ms |

The host was an AMD Ryzen 9 9950X running Linux under WSL2. Each case was warmed up, then repeated 30 times in Node or 40 times in Chromium. Timings include the detector and label marshalling, but exclude decoding, capture, rendering, worker transfer, model loading and recording. These measurements do not establish Pixel performance, sustained camera throughput or a 60 fps end-to-end guarantee. They also do not rule out gains from moving a larger portion of the pipeline into native code or WebAssembly.

### Alternative primitives

OpenCV 4.13.0 Python bindings were also used to compare connected-component/PCA candidates, a simple collinear pairing extension, Canny plus probabilistic Hough, bright-mask Hough, and the Line Segment Detector. The experiment retained the same brightness mask for comparisons that use one. Hough used a one-pixel rho step, a one-degree angle step, 20 votes, the configured minimum length, and a maximum gap of 10% of image height. LSD used its standard refinement.

Twelve frames had approximately annotated visible bright-cap extremities, inspected at twice the analysis resolution. Annotation uncertainty is roughly 2–3 analysis pixels. A diagnostic match requires both segment ends within five pixels, allowing the endpoint order to reverse. These labels describe visible light, not calibrated physical tip centers or movement quality. Nine ambiguous frames were excluded from endpoint-error counts, but retained in the component-adapter comparison.

| Candidate method | Threshold 175: first / best candidate matches | Threshold 250: first / best candidate matches |
| --- | ---: | ---: |
| Existing detector | 6 / 6 of 12 | 11 / 11 of 12 |
| Components plus PCA, no pairing | 0 / 0 | 0 / 0 |
| Components plus PCA and collinear pairing | 1 / 2 | 11 / 11 |
| Canny plus HoughLinesP | 0 / 0 | 0 / 0 |
| Bright-mask HoughLinesP | 0 / 2 | 0 / 0 |
| Line Segment Detector | 0 / 0 | 0 / 0 |

“Best” uses the annotation to choose a candidate and is an oracle upper bound, not an implemented selection policy. Alternative candidates were ranked by length; the existing detector retained its own ranking. This is not a tuned comparison of complete detectors. In particular, an accurate edge or luminous half fails a full-staff endpoint test. Hough and LSD frequently found such fragments or background edges, which would still need joining and verification. More candidates alone are not evidence of better accuracy.

The component-pairing result shows why standard primitives are useful and why staff-specific logic remains necessary. Threshold choice also mattered: one fully visible late-recording staff was recovered by the existing cold-start detector at 175 but missed at 250. A component-library substitution cannot repair a mask that has already discarded the relevant shaft pixels.

### Optical flow

Pyramidal Lucas–Kanade flow was tested on eight 30-frame sequences from two recordings. It started at manually annotated visible tips, used 21×21 windows and three pyramid levels, and checked the forward/backward displacement at every step against a one-pixel limit. Three sequences tripped that check. Five passed every step, yet inspection found clear drift in passing sequences: one tip attached to a background pattern while the staff rotated away.

Flow therefore remains a candidate for short-lived search hints or motion association, with fresh image verification. Forward/backward agreement is a consistency check, not evidence that a point still belongs to the staff. OpenCV's own guidance describes brightness constancy and neighboring-motion assumptions, and warns that flow can follow a similar-looking point after the original disappears. Changing LED patterns, motion blur and occlusion make that distinction material here. [OpenCV optical-flow documentation](https://docs.opencv.org/4.13.0/db/d7f/tutorial_js_lucas_kanade.html).

## Framework fit and costs

**OpenCV is the most relevant framework.** Its component statistics, robust line fitting, Hough methods and optical flow fit the existing pipeline. Android has an officially maintained Maven AAR, and the tested OpenCV.js artifact exposed `connectedComponentsWithStats`, `fitLine`, `HoughLinesP` and `calcOpticalFlowPyrLK`. `createLineSegmentDetector` was absent from that downloaded JavaScript runtime despite appearing in the source export configuration, so API availability must be tested for the exact shipped build. [Android distribution](https://opencv.org/opencv4android-usage-models/), [shape primitives](https://docs.opencv.org/4.13.0/d3/dc0/group__imgproc__shape.html), [line primitives](https://docs.opencv.org/4.13.0/dd/d1a/group__imgproc__feature.html).

Measured distribution costs for version 4.13.0 were 121,695,690 bytes for the multi-ABI Android AAR and 10,964,323 bytes for the stock JavaScript artifact, or 3,542,502 bytes with local gzip level 9. The AAR size is not the installed APK increase; ABI selection and module selection change that cost. A production browser build can separate the Wasm payload and enable SIMD. Pin and serve all assets locally, reuse buffers, release native matrices, and benchmark copies across each language boundary. OpenCV 4.5 and later uses Apache-2.0. [AAR artifact](https://repo.maven.apache.org/maven2/org/opencv/opencv/4.13.0/opencv-4.13.0.aar), [JavaScript artifact](https://docs.opencv.org/4.13.0/opencv.js), [build options](https://docs.opencv.org/4.13.0/d4/da1/tutorial_js_setup.html), [license](https://opencv.org/license/).

**MediaPipe is not an existing LED-staff detector.** Its Object Detector runs locally on Android and the web, but outputs categories, scores and boxes. Its recommended COCO models do not have an LED-staff label. A baseball-bat label is not an endpoint or visibility model. The recommended EfficientDet-Lite0 int8 model alone is 4,602,795 bytes, separate from its runtime. Google's published Pixel 6 latency for that model is 29.31 ms on CPU, already above a complete 60 fps frame budget; that is not a Pixel 9 benchmark. A learned approach needs a custom model and representative training/validation data. [Task, outputs and benchmarks](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector), [label map](https://storage.googleapis.com/mediapipe-tasks/object_detector/labelmap.txt), [model artifact](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite).

**LiteRT and ONNX Runtime are deployment options if a suitable model is developed.** They do not solve the missing model or training-data problem. A useful model would estimate staff masks or endpoint heatmaps with explicit per-end visibility, rather than only boxes. Both have local browser paths; LiteRT also has Android support, and ONNX Runtime offers mobile builds. Bundle the weights and runtime locally, measure initialization and memory, and validate the exact operators and acceleration fallback on each target. Runtime package size depends on the selected build and model. LiteRT and MediaPipe use Apache-2.0; ONNX Runtime uses MIT. Model weights and bundled third-party components need their own notices. [LiteRT](https://developers.google.com/edge/litert/overview), [LiteRT web](https://developers.google.com/edge/litert/web), [ONNX Runtime web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), [LiteRT license](https://github.com/google-ai-edge/LiteRT/blob/main/LICENSE), [MediaPipe license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE), [ONNX Runtime license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE).

**ARCore depth is not a useful prerequisite for this task.** Its depth-from-motion approach is aimed at scene geometry; automatic depth works best on static scenes and adds processing load. Optional hardware depth support is device-dependent. A stationary practice camera observing thin, fast, glowing objects is a poor match, and ordinary browser webcams do not provide an equivalent shared input. This is an applicability inference from the documented operating conditions, not a measured Pixel depth result. Retain projected 2D scoring. [Depth overview](https://developers.google.com/ar/develop/depth), [DepthMode behavior](https://developers.google.com/ar/reference/java/com/google/ar/core/Config.DepthMode).

## Practical next step

The concrete small implementation candidate is an internal component-extraction boundary with reusable buffers and common fixtures. Keep the existing backend as the default. The prototype demonstrates that an OpenCV backend can preserve the mask and downstream rules, which makes a controlled later comparison possible without changing scoring at the same time.

Adopt a shipped OpenCV backend only after it provides a measured benefit:

1. Label visible ends, missing ends, clipping, blur, false background matches and identity ambiguity across whole clips. Hold out recordings from tuning. Score endpoint error and false precise observations, not just detection count.
2. Profile the complete pipeline on the physical Pixel and target webcam browser while preview and recording run. Include sustained frame cadence, tail latency, allocations, heat and startup cost.
3. If image primitives dominate, move enough work into one reusable native/Wasm operation to amortize copies. Preserve staff-specific pairing and current-pixel endpoint verification. A shared C++ implementation could reduce Kotlin/JavaScript duplication, but requires JNI/Emscripten builds and parity testing.
4. Compare the same frames, timestamps and configuration on both backends. Require equivalent missing/uncertain states and an accuracy or latency improvement before selecting the new backend.

A separate small accuracy experiment is local threshold recovery after acquisition fails: search a bounded recent-staff region, then require fresh shaft and cap evidence before restoring precision. The observed threshold failure motivates that experiment, but these samples do not establish a safe general threshold or justify silently lowering it everywhere.

## Future experiment: visible sweep adherence

A circle-specific observation could address useful feedback during rotational blur. A visible tip can sweep along a circle during an exposure even when its instantaneous angle cannot be recovered. If that tip-sweep boundary can be identified, its radial distance from the fixed calibrated guide remains measurable. This is a proposed observable, not a demonstrated capability of the current detector. Research on exposure trajectories supports treating blur as motion evidence, but does not validate this proposed staff metric. [Exposure Trajectory Recovery from Motion Blur](https://arxiv.org/abs/2010.02484).

Measure the supported outer boundary of each identifiable tip sweep in the rectified practice plane, using the existing guide center and radius. Report radial deviation, supported angular coverage and uncertainty as **visible sweep adherence**. Do not fit a new circle independently to each blurred region: that would allow the reference to follow an incorrect movement. Keep this observation separate from precise endpoints, instantaneous staff angle, beat timing and the existing precision streak.

The hard part is establishing that a boundary is a tip trajectory. Shaft pixels fill the interior of a rotating fan; halos can extend beyond a physical tip; reflections and bright background edges can resemble arcs. Require positive staff/shaft association and identifiable evidence for both relevant tip sweeps, reject clipping and overlapping ambiguous regions, and return unavailable when that evidence is absent. A short arc needs sufficient curvature or other cap evidence to distinguish a tip sweep from a shaft edge. Neither a fitted circle nor a low residual alone proves that distinction.

A useful evaluation would compare a fixed guide against known good circles and deliberately wrong radii, eccentric/translated circles, ellipses, irregular paths, exposure fans, changing LEDs, partial occlusion and background arcs. Vary exposure and preserve sharp-frame references where available. Test whether observed sweep support predicts the intended radial property without rewarding a small correct fragment while the rest of the motion is wrong. Visible support cannot prove what happened during dark or hidden portions of the exposure. No accuracy, coverage or streak-credit claim is justified until those tests pass.
