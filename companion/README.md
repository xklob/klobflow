# Klobflow local practice space

The practice toolbar puts **Auto-fit**, **Background · 5s**, and **LED colors & lights** beside the preview. **Full screen** keeps large feedback, recording, and an explicit exit button visible. Tutorials start with one step; expand them for the full setup instructions. The line/ring legend opens below the preview when needed.

Requires Node 22 or newer. Extract this ZIP, run `node server.mjs` in this folder, then open http://localhost:8788. No npm install is needed to run it.

Choose **Use PC camera** for fully local browser practice without a phone. The app measures capture modes and prioritizes actual frame rate. Recordings and analysis save in browser storage; export them from the practice log. Chrome/Edge are tested.

For Android mode, enable PC sharing in Klobflow on your phone. Choose **USB cable** or **Wi-Fi / LAN** in the connection dialog. There is no pairing code. Anyone on the same LAN can access an enabled phone share.

USB requires Android platform-tools (`adb`), a data-capable cable, USB debugging enabled in Android Developer options, and approval of this PC in Android's native prompt. Connect one USB Android device. `KLOBFLOW_ADB` can select an adb executable outside PATH. On WSL, the companion automatically uses Windows adb and a local binary pipe through Windows curl; it does not open a Windows network relay or change the firewall.

Use **Calibrate viewing angle** to select top left, top right, bottom right, and bottom left corners of a real rectangle in your movement plane. Enter its physical width divided by height (1 for a square). Amber tip rings and direction labels lead to high-contrast rings labelled TARGET; checked tip rings mark tips within tolerance. Calibration only corrects that plane, not depth or lens distortion. Keep the camera fixed and recalibrate after moving it.

Source, screenshots, release notes, and verification limits: https://github.com/xklob/klobflow

Choose one or two double-ended staves. Each practice mode has a dismissible setup tutorial. Auto-fit runs only when you press it and collects reliable endpoints; Match staff length matches the circle diameter / guide width to the prop. Manual Auto-fit can adjust hardware zoom conservatively. Reset guide layout restores center X/Y, size, rotation, and circle separation while retaining camera, calibration, and tempo settings.

Beat practice supports manual BPM, tap tempo, 2/4/8 target points, and separate timing (milliseconds early/late) and position (percent of guide width) feedback. Use Start beat now to set the pulse phase.

Use PC system audio to follow music from a shared tab or screen with audio enabled. This can drive either PC-camera practice or the Android camera over USB/LAN. Use phone audio requests native approval on the Android device. Allow 6–10 seconds to establish tempo, use Half/Double for rhythmic ambiguity, and use Audio offset for timing latency. Missing/silent/unsupported audio pauses beat feedback. Use manual BPM / stop audio releases capture and restores manual timing. Audio is never recorded or uploaded.

For fast spins, prioritize 60 fps or faster capture over resolution. Camera mode results and the live readouts separate requested, reported, delivered, and analysis rates. Zoom retains the selected capture rate. Exposure for spinning offers shorter shutter settings when the camera exposes them. Broad LED blur keeps an approximate dashed outline with precision paused. The separate tracking panel explains uncertainty. Lime and purple lines identify staff A and B, not alignment quality. Amber tip arrows lead to rings labelled TARGET. TIPS ON TARGET confirms that all tips are in tolerance while ON GUIDE settles; no absent correction arrows are referenced. Coaching fades slowly, while uncertain measurements immediately pause scoring. The desktop UI includes larger body and helper text, a text-size option, and full-screen practice.

Keep every selected staff tip within tolerance to build an alignment streak. After 2, 5, and 10 seconds, brighter tip halos, orbiting particles, and gold rings reward sustained alignment. The preview shows elapsed time and your best streak for the current setup. Leaving the guide ends it; uncertain tracking pauses credit and ends it after 350 ms. Free flow keeps decorative trails without earning a streak. Toggle Streak glow & particles to disable these effects. Guide/camera changes reset the attempt, and the effects never alter measured scores.

Capture background counts down five seconds, then saves a fixed local baseline. Move the staves out of the image during capture to exclude stationary lamps and sunlight afterward. Keep the camera fixed and recapture after movement or lighting changes. Clear background removes it; camera/zoom/mirror/exposure changes invalidate it. Staff LED colors can restrict detection to one or several colors, preserving nearby white LED cores. Any / rainbow disables the color filter. White light alone cannot distinguish a staff from sunlight.

Displayed alignment, angle, and symmetry errors average valid observations over five seconds and pause immediately on uncertain tracking. Raw measurements still drive live cues and saved per-frame analysis. Trails connect nearby detections with only a subtle brightness lift at samples, and stop at missing observations.
