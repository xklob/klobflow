# Klobflow local practice space

Requires Node 22 or newer. Extract this ZIP, run `node server.mjs` in this folder, then open http://localhost:8788. No npm install is needed to run it.

Choose **Use PC camera** for fully local browser practice without a phone. The app measures capture modes and prioritizes actual frame rate. Recordings and analysis save in browser storage; export them from the practice log. Chrome/Edge are tested.

For Android mode, enable PC sharing in Klobflow on your phone. Choose **USB cable** or **Wi-Fi / LAN** in the connection dialog. There is no pairing code. Anyone on the same LAN can access an enabled phone share.

USB requires Android platform-tools (`adb`), a data-capable cable, USB debugging enabled in Android Developer options, and approval of this PC in Android's native prompt. Connect one USB Android device. `KLOBFLOW_ADB` can select an adb executable outside PATH. On WSL, the companion automatically uses Windows adb and a local binary pipe through Windows curl; it does not open a Windows network relay or change the firewall.

Use **Calibrate viewing angle** to select top left, top right, bottom right, and bottom left corners of a real rectangle in your movement plane. Enter its physical width divided by height (1 for a square). Orange arrows point staff tips toward guide targets; green rings mark tips within tolerance. Calibration only corrects that plane, not depth or lens distortion. Keep the camera fixed and recalibrate after moving it.

Source, screenshots, release notes, and verification limits: https://github.com/xklob/klobflow

Choose one or two double-ended staves. Each practice mode has a dismissible setup tutorial. Fit center & size collects reliable endpoints; Match staff length matches the circle diameter / guide width to the prop. Startup fitting can adjust hardware zoom conservatively.

Beat practice supports manual BPM, tap tempo, 2/4/8 target points, and separate timing (milliseconds early/late) and position (percent of guide width) feedback. Use Start beat now to set the pulse phase.
