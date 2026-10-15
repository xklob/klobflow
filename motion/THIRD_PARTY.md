# Third-party components

Runtime downloads are external to the repository and APK. No private video is sent to a model provider.

| Component | Pinned source/version | License / use |
| --- | --- | --- |
| EdgeTAM | [Meta, commit 7711e012a30a2402c4eaab637bdb00a521302c91](https://github.com/facebookresearch/EdgeTAM/tree/7711e012a30a2402c4eaab637bdb00a521302c91) | Apache-2.0, including upstream bundled model weights; video segmentation built on SAM 2 |
| EdgeTAM checkpoint | `checkpoints/edgetam.pt` in that revision | SHA-256 `ed2d4850b8792c239689b043c47046ec239b6e808a3d9b6ae676c803fd8780df` |
| PyTorch / torchvision | 2.8.0 / 0.23.0 | BSD-style; local model execution |
| timm | 1.0.15 | Apache-2.0; image encoder architecture |
| OpenCV | 5.0.0.93 Python distribution | Apache-2.0; calibration, image transforms, line fitting, Kalman filter |
| NumPy / SciPy | See `requirements.txt` | BSD-3-Clause; numerical operations |
| FastAPI / Uvicorn | See `requirements.txt` | MIT / BSD-3-Clause; localhost service |
| Pillow | See `requirements.txt` | HPND; bounded image-header decoding |
| CameraX / AndroidX | See `motion-phone/build.gradle.kts` | Apache-2.0; camera capture and native UI |
| NanoHTTPD | 2.3.1 | BSD-3-Clause; optional LAN/USB camera stream |

The EdgeTAM streaming adapter uses upstream predictor state and limits retained frames to the model's memory window. `OfflineBackbone` uses the same timm architecture and parameter names but disables the redundant ImageNet download: the complete verified EdgeTAM checkpoint supplies its weights. The runtime uses 512-pixel model input; this differs from upstream's 1024-pixel default and its published benchmarks.

Research-only adapters in `vision.py` can compare [Google DeepMind TAPNext / BootsTAPIR](https://github.com/google-deepmind/tapnet) (Apache-2.0). Their code and weights are not installed by normal setup or selected by the application. The research checkout used commit `730cda1c730877cfedbe01bf87fb1cadb78a565d`.
