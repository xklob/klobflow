import { defaults, demoFrame } from "./demo.mjs";
import { FrameDecoder } from "./stream.mjs";
import { BrowserCamera } from "./browser-camera.mjs";
const $ = (id) => document.getElementById(id);
const canvas = $("view"),
  ctx = canvas.getContext("2d"),
  chart = $("chart"),
  chartCtx = chart.getContext("2d");
let config = { ...defaults },
  paired = false,
  localMode = false,
  localStarting = false,
  demo = false,
  replay = null,
  current = null,
  lastTime = null,
  lastArrival = 0,
  seeding = false,
  calibrating = false,
  transport = "lan",
  picks = [],
  lastImage = null;
let streamController = null, nextStreamAt = 0, arrivals = [], previewFps = 0, lastConfigText = "";
let trail = [],
  history = [];
const localCamera = new BrowserCamera($("local-video"), {
  onFrame: f => { if (localMode && !replay) { lastArrival = Date.now(); syncConfig(f.currentConfig); acceptFrame(f); } },
  onStatus: text => { if (localMode) { message(text); enableControls(); } },
  onSessions: () => { if (localMode) loadSessions(); },
});
async function updateDeviceList() {
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
  $("local-camera-select").replaceChildren(...cameras.map((d,i) => Object.assign(document.createElement("option"), { value: d.deviceId, textContent: d.label || `Camera ${i+1}` })));
  $("local-camera-select").value = localCamera.deviceId || cameras[0]?.deviceId || "";
}
async function startLocal(recheck = false) {
  if (localStarting) return;
  if (localCamera.recording || localCamera.finalizing) { message("Stop recording before changing camera settings."); return; }
  localStarting = true;
  try {
    if (paired) await api("/api/disconnect", {});
    stopStream(); paired = false; demo = false; replay = null; localMode = true;
    resetView(); updateSourceControls(); syncConfig(localCamera.config);
    await localCamera.start({deviceId: $("local-camera-select").value || undefined, target: $("capture-target").value, reuse: !recheck && !!localCamera.profile});
    await updateDeviceList();
    $("camera-profile").textContent = `Selected ${localCamera.settings.width} × ${localCamera.settings.height}, ${Math.round(localCamera.profile.measuredFps)} fps measured. ` + (localCamera.zoom.min === localCamera.zoom.max ? "This camera does not expose adjustable zoom." : "Widest supported zoom is the default.");
    try { localStorage.setItem("klobflow.lastMode", "local"); } catch {}
    connected(false); loadSessions();
  } catch (e) { message(e.message); }
  finally { localStarting = false; updateSourceControls(); }
}
function updateSourceControls() {
  $("local-video").hidden = !localMode || !!replay;
  $("local-camera-settings").hidden = !localMode;
  $("phone-camera-setting").hidden = localMode;
  $("phone-fps-setting").hidden = localMode;
  $("local-open").disabled = localStarting;
  $("local-stage").disabled = localStarting;
  $("local-open").textContent = localMode && localCamera.active ? "Stop PC camera" : "Use PC camera";
  $("optimize-camera").disabled = localStarting || localCamera.recording || localCamera.finalizing;
  $("local-camera-select").disabled = localStarting || localCamera.recording || localCamera.finalizing;
  $("capture-target").disabled = localStarting || localCamera.recording || localCamera.finalizing;
  enableControls();
}
$("local-open").onclick = async () => {
  if (localMode && localCamera.active) { localCamera.resumeOnVisible = false; await localCamera.stop(); resetView(); connected(false); updateSourceControls(); }
  else startLocal();
};
$("local-stage").onclick = () => startLocal();
$("local-camera-select").onchange = () => { localCamera.profile = null; startLocal(true); };
$("capture-target").onchange = () => startLocal(true);
$("optimize-camera").onclick = () => startLocal(true);
let sessionVideoUrl = null;
$("close-video").onclick = () => $("video-dialog").close();
$("video-dialog").onclose = () => { $("session-video").pause(); $("session-video").removeAttribute("src"); if (sessionVideoUrl) URL.revokeObjectURL(sessionVideoUrl); sessionVideoUrl = null; };
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const descriptions = {
  grid: "Trace clean lines through the grid. Error measures tip distance to the nearest guide line.",
  circles:
    "Follow overlapping circles. Error measures tip distance from the nearest circumference.",
  cube: "Align staff tips with cube vertices. This is a projected reference, not a measurement of 3D depth.",
  free: "Move freely. Track staves and explore your trails without a grid-alignment score.",
};
async function api(route, body) {
  if (localMode && route === "/api/control") return localCamera.command(body);
  const response = await fetch(
    route,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  return value;
}
function message(text) {
  $("message").hidden = !text;
  $("message").textContent = text;
}
function connected(value) {
  paired = value;
  $("connection").classList.toggle("connected", value);
  $("connection").replaceChildren(
    Object.assign(document.createElement("i"), {}),
    document.createTextNode(
      value ? (transport === "usb" ? "USB CONNECTED" : "WI-FI CONNECTED") : localMode ? (localCamera.active ? "PC CAMERA" : "PC CAMERA STOPPED") : demo ? "DEMO MODE" : "PHONE NOT CONNECTED",
    ),
  );
  $("pair-open").textContent = value ? "Disconnect" : "Connect phone ↗";
  if (!value) stopStream();
  enableControls();
}
function enableControls() {
  const available = paired || (localMode && localCamera.active);
  document
    .querySelectorAll("[data-config], [data-mode]")
    .forEach((e) => (e.disabled = !(available || demo) || !!replay));
  $("calibrate").disabled = !available || !!replay || !current;
  $("clear-calibration").disabled = !available || !!replay || !config.planeCorners?.length;
  $("zoom-wide").disabled = !available || !!replay || !current?.cameraReady;
  $("reset").disabled = !available || !!replay;
  $("seed").disabled = !available || !!replay;
  $("optimize-camera").disabled = localStarting || localCamera.recording || localCamera.finalizing;
  $("record").disabled =
    !available ||
    !!replay ||
    current?.source === "demo" ||
    !current?.cameraReady ||
    current?.finalizing;
}
function syncConfig(c) {
  const text = JSON.stringify(c);
  if (text === lastConfigText) return;
  lastConfigText = text;
  config = { ...config, ...c };
  document.querySelectorAll("[data-config]").forEach((el) => {
    const key = el.dataset.config;
    if (document.activeElement === el && el.type === "range") return;
    if (el.type === "checkbox") el.checked = !!config[key];
    else el.value = String(config[key]);
    if (el.type === "range") rangeLabel(el);
  });
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === config.mode),
    );
  $("calibration-info").textContent = config.planeCorners?.length ? "Perspective correction active. Measurements use the calibrated plane. Keep all four tips inside it. Recalibrate after moving the camera." : "Mark a rectangle in your movement plane, clockwise from top left. Use width ÷ height = 1 for a square. Zoom, mirror, camera, or rotation changes clear calibration.";
  $("mode-description").textContent = descriptions[config.mode];
  $("depth-control").hidden = config.mode !== "cube";
  $("circles-control").hidden = config.mode !== "circles";
  $("error-label").textContent =
    config.mode === "cube"
      ? "VERTEX ERROR"
      : config.mode === "circles"
        ? "CIRCLE ERROR"
        : config.mode === "free"
          ? "FREE FLOW"
          : "GRID ERROR";
  $("deviation-hint").textContent =
    config.mode === "cube"
      ? "Tip distance / guide width"
      : config.mode === "circles"
        ? "Radial error / diameter"
        : "Tip distance / guide width";
}
function rangeLabel(el) {
  const value = Number(el.value),
    key = el.dataset.config;
  const output = document.querySelector(`output[for="${el.id}"]`);
  if (output)
    output.textContent =
      key === "rotation"
        ? `${value}°`
        : key === "threshold"
          ? `${value}`
          : key === "tolerance"
            ? `${value}%`
            : `${Math.round(value * 100)}%`;
}
let configChain = Promise.resolve();
function patch(update) {
  configChain = configChain.then(async () => {
    if (demo) {
      syncConfig({ ...config, ...update });
      trail = [];
      return;
    }
    try {
      const result = await api("/api/control", {
        action: "config",
        config: update,
      });
      syncConfig(result.config);
      trail = [];
      history = [];
      message("");
    } catch (e) {
      message(e.message);
      syncConfig(config);
    }
  });
}
document
  .querySelectorAll("[data-mode]")
  .forEach((b) => (b.onclick = () => patch({ mode: b.dataset.mode })));
document.querySelectorAll("[data-config]").forEach((el) => {
  el.addEventListener("input", () => {
    if (el.type === "range") rangeLabel(el);
  });
  el.addEventListener("change", () =>
    patch({
      [el.dataset.config]:
        el.type === "checkbox"
          ? el.checked
          : el.type === "range" || el.dataset.config === "fps"
            ? Number(el.value)
            : el.value,
    }),
  );
});
function openPair() {
  $("pair-error").textContent = "";
  $("pair-dialog").showModal();
  $("transport").focus();
}
$("pair-open").onclick = async () => {
  if (paired) {
    await api("/api/disconnect", {});
    connected(false);
    resetView();
  } else openPair();
};
$("connect-stage").onclick = openPair;
$("transport").onchange = () => {
  const usb = $("transport").value === "usb";
  $("address-field").hidden = usb; $("phone-address").required = !usb; $("usb-help").hidden = !usb;
};
$("zoom").oninput = () => { document.querySelector('output[for="zoom"]').textContent = `${Number($("zoom").value).toFixed(2)}×`; };
$("zoom").onchange = () => patch({ zoom: Number($("zoom").value) });
$("zoom-wide").onclick = () => patch({ zoom: 0 });
$("cancel-pair").onclick = () => $("pair-dialog").close();
$("pair-form").onsubmit = async (e) => {
  e.preventDefault();
  $("pair-submit").disabled = true;
  $("pair-error").textContent = "";
  try {
    const result = await api("/api/pair", {
      address: $("phone-address").value.trim(),
      transport: $("transport").value,
    });
    transport = result.transport;
    stopStream();
    await localCamera.stop(); localMode = false; updateSourceControls();
    try { localStorage.setItem("klobflow.lastMode", "phone"); } catch {}
    $("pair-dialog").close();
    demo = false;
    replay = null;
    trail = [];
    history = [];
    lastTime = null;
    connected(true);
    message("");
    await loadSessions();
  } catch (err) {
    $("pair-error").textContent = err.message;
  } finally {
    $("pair-submit").disabled = false;
  }
};
function resetView() {
  current = null;
  lastTime = null;
  lastImage = null;
  trail = [];
  history = [];
  seeding = false;
  calibrating = false;
  picks = [];
  $("empty-state").hidden = false;
  $("stage-badge").hidden = true;
  $("tracking-label").textContent = "Waiting for your phone";
  $("source-label").textContent = "YOUR PRACTICE VIEW";
  $("live-dot").style.background = "";
  $("seed-message").hidden = true;
  setMetrics(null);
  setCoaching(null);
  drawEmpty();
  drawChart();
}
$("demo-start").onclick = async () => {
  await localCamera.stop(); localMode = false; updateSourceControls();
  demo = true;
  replay = null;
  lastTime = null;
  connected(false);
  syncConfig(config);
  message(
    "Demo shows generated motion. It is not an assessment of a real practice session.",
  );
};
$("fullscreen").onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else
    $("stage")
      .requestFullscreen()
      .catch((e) => message(e.message));
};
$("reset").onclick = async () => {
  try {
    await api("/api/control", { action: "reset" });
    trail = [];
    history = [];
    message("Tracking reset. Hold both staves clearly in frame.");
  } catch (e) {
    message(e.message);
  }
};
$("record").onclick = async () => {
  const action = current?.recording ? "stop" : "record";
  $("record").disabled = true;
  try {
    await api("/api/control", { action });
    message(
      action === "record"
        ? localMode ? "Recording in this browser. Video and analysis stay on this PC." : "Recording on your phone. Video and analysis save locally."
        : localMode ? "Saving your practice in this browser." : "Saving your practice on the phone.",
    );
  } catch (e) {
    message(e.message);
  } finally {
    enableControls();
  }
};
$("seed").onclick = () => {
  calibrating = false;
  $("calibrate").textContent = "Calibrate viewing angle";
  seeding = !seeding;
  picks = [];
  $("seed").textContent = seeding ? "Cancel selection" : "Identify staves";
  $("seed-message").hidden = !seeding;
  $("seed-message").textContent = "Hold staves still. Tap staff A, end 1.";
};
$("calibrate").onclick = () => {
  calibrating = !calibrating; seeding = false; picks = [];
  $("seed").textContent = "Identify staves";
  $("calibrate").textContent = calibrating ? "Cancel calibration" : "Calibrate viewing angle";
  $("seed-message").hidden = !calibrating;
  $("seed-message").textContent = "Rectangle in your movement plane: tap top left.";
};
$("clear-calibration").onclick = () => patch({ planeCorners: [] });
canvas.addEventListener("click", async (e) => {
  if ((!seeding && !calibrating) || !current) return;
  const rect = canvas.getBoundingClientRect(),
    scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const x =
      (e.clientX - rect.left - (rect.width - canvas.width * scale) / 2) /
      (canvas.width * scale),
    y =
      (e.clientY - rect.top - (rect.height - canvas.height * scale) / 2) /
      (canvas.height * scale);
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  picks.push([x, y]);
  render(current, lastImage);
  if (picks.length === 4) {
    try {
      await api("/api/control", calibrating ? { action: "calibrate", points: picks, aspect: Number($("plane-aspect").value) } : { action: "seed", points: picks });
      trail = [];
      message(calibrating ? "Viewing angle calibrated. Keep the camera fixed and the staves in this plane." : "Staff selection applied. Move slowly while tracking settles.");
    } catch (err) {
      message(err.message);
    }
    seeding = false;
    calibrating = false;
    picks = [];
    $("calibrate").textContent = "Calibrate viewing angle";
    $("seed-message").hidden = true;
    $("seed").textContent = "Identify staves";
  } else
    $("seed-message").textContent =
      calibrating ? `Tap ${["top left", "top right", "bottom right", "bottom left"][picks.length]}.` : `Hold still. Tap staff ${picks.length < 2 ? "A" : "B"}, end ${(picks.length % 2) + 1}.`;
});
function drawEmpty() {
  canvas.width = 960;
  canvas.height = 720;
  ctx.fillStyle = "#090e09";
  ctx.fillRect(0, 0, 960, 720);
  ctx.strokeStyle = "#263621";
  ctx.lineWidth = 1;
  for (let x = 0; x < 960; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 720);
    ctx.stroke();
  }
  for (let y = 0; y < 720; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(960, y);
    ctx.stroke();
  }
}
function render(frame, image) {
  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  const w = canvas.width,
    h = canvas.height,
    u = Math.min(w, h),
    g = frame.guide,
    c = frame.config;
  ctx.clearRect(0, 0, w, h);
  if (image) ctx.drawImage(image, 0, 0, w, h);
  else if (!localMode || replay) {
    const gradient = ctx.createRadialGradient(
      w / 2,
      h / 2,
      10,
      w / 2,
      h / 2,
      w * 0.7,
    );
    gradient.addColorStop(0, "#20301b");
    gradient.addColorStop(1, "#080c09");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
  const line = (a, b, color, width = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a[0] * u, a[1] * u);
    ctx.lineTo(b[0] * u, b[1] * u);
    ctx.stroke();
  };
  if (c.showGuide) {
    ctx.setLineDash([6, 7]);
    for (const s of g.lines) line(s.a, s.b, "#e9f1e266", 1.4);
    for (const circle of g.circles) {
      ctx.strokeStyle = "#e9f1e266";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(
        circle.center[0] * u,
        circle.center[1] * u,
        circle.radius * u,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    for (const path of g.paths || []) for (let i = 1; i < path.length; i++) line(path[i - 1], path[i], "#e9f1e266", 1.5);
    ctx.setLineDash([]);
    for (const p of g.vertices) {
      ctx.fillStyle = "#c6edaa";
      ctx.beginPath();
      ctx.arc(p[0] * u, p[1] * u, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (c.trails)
    trail.forEach((f, i) =>
      f.staffs.forEach((s, n) => {
        if (!s || s.confidence < 0.55) return;
        ctx.globalAlpha = Math.min(1, ((i + 1) / trail.length) * 1.35);
        ctx.fillStyle = n ? "#b5a3ff" : "#b6f36b";
        for (const p of [s.a, s.b]) {
          ctx.beginPath();
          ctx.arc(p[0] * u, p[1] * u, 4.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }),
    );
  ctx.globalAlpha = 1;
  frame.staffs.forEach((s, n) => {
    if (!s) return;
    const color = n ? "#b5a3ff" : "#b6f36b";
    ctx.globalAlpha = s.confidence < 0.55 ? 0.35 : 1;
    if (frame.source === "demo" && !image) {
      ctx.shadowBlur = 20;
      ctx.shadowColor = color;
    }
    line(s.a, s.b, color, frame.source === "demo" && !image ? 6 : 3);
    ctx.shadowBlur = 0;
    for (const p of [s.a, s.b]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p[0] * u, p[1] * u, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.font = "12px system-ui";
    ctx.fillText(
      `${n ? "B" : "A"}  ${s.occluded ? "briefly hidden" : Math.round(s.confidence * 100) + "%"}`,
      s.a[0] * u + 10,
      s.a[1] * u - 10,
    );
  });
  ctx.globalAlpha = 1;
  if (c.showFeedback !== false) for (const cue of frame.feedback || []) {
    const color = cue.onTarget ? "#b6f36b" : "#ffb45e";
    const a = cue.tip, b = cue.target;
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(a[0] * u, a[1] * u, 10, 0, Math.PI * 2); ctx.stroke();
    if (!cue.onTarget) {
      line(a, b, "#000b", 6); line(a, b, color, 3);
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (const d of [-0.5, 0.5]) line(b, [b[0] - Math.cos(angle + d) * 12 / u, b[1] - Math.sin(angle + d) * 12 / u], color, 3);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b[0] * u, b[1] * u, 5, 0, Math.PI * 2); ctx.stroke();
    }
  }
  for (const p of picks) {
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.arc(p[0] * w, p[1] * h, 8, 0, Math.PI * 2);
    ctx.stroke();
  }
}
function setCoaching(f) {
  const good = f?.staffs?.filter(s => s && s.confidence >= 0.55).length || 0;
  const cues = f?.feedback || [], aligned = cues.length === 4 && cues.every(c => c.onTarget);
  const free = f?.config?.mode === "free";
  $("coaching").classList.toggle("aligned", aligned); $("coaching").classList.toggle("adjust", cues.length > 0 && !aligned);
  $("coaching-title").textContent = f?.staffs?.some(s => s?.occluded) ? "Tip hidden · keeping staff identity" : good < 2 ? "Keep both staves visible" : free ? "Free flow · no alignment target" : !cues.length ? "Alignment cues paused" : aligned ? "✓ Tips on guide" : "Adjust highlighted tips";
  $("coaching-detail").textContent = f?.staffs?.some(s => s?.occluded) ? "Continue your movement. Tracking reconnects when the tip returns; precision scores wait for visible tips." : good < 2 ? `${good} / 2 staves tracked. Scores pause until both are clear.` : free ? "Choose Grid, Circles, or Cube for alignment cues." : !cues.length ? "Keep all four tips inside the calibrated plane. Saved older sessions may not include cues." : aligned ? `All four tips are within the ${f.config.tolerance}% target. Keep tracing the guide.` : `${cues.filter(c => !c.onTarget).length} / 4 tips outside target. Follow orange arrows toward white rings.`;
}
function setMetrics(metrics) {
  for (const [key, suffix] of [
    ["deviation", "%"],
    ["angle", "°"],
    ["symmetry", "%"],
    ["steadiness", "%"],
  ]) {
    const value = metrics?.[key];
    $(key).style.color =
      (key === "deviation" || key === "symmetry") &&
      typeof value === "number" &&
      value > config.tolerance
        ? "#edc293"
        : "";
    $(key).replaceChildren(
      document.createTextNode(
        typeof value === "number" ? value.toFixed(1) : "—",
      ),
      Object.assign(document.createElement("small"), { textContent: suffix }),
    );
  }
  if (metrics)
    $("coverage").textContent =
      `Tracking coverage: ${Math.round(metrics.coverage)}% · recent 1.2s`;
  else $("coverage").textContent = "Tracking coverage: —";
}
function drawChart() {
  const w = chart.width,
    h = chart.height;
  chartCtx.clearRect(0, 0, w, h);
  chartCtx.strokeStyle = "#34402d";
  chartCtx.lineWidth = 1;
  for (let y = 25; y < h; y += 40) {
    chartCtx.beginPath();
    chartCtx.moveTo(28, y);
    chartCtx.lineTo(w, y);
    chartCtx.stroke();
  }
  const max = Math.max(
    10,
    config.tolerance * 2,
    ...history.map((f) => f.metrics?.deviation ?? 0),
  );
  const targetY = h - 4 - (config.tolerance / max) * (h - 20);
  chartCtx.fillStyle = "#b6f36b0d";
  chartCtx.fillRect(28, targetY, w - 28, h - targetY);
  chartCtx.strokeStyle = "#b6f36b66";
  chartCtx.setLineDash([4, 5]);
  chartCtx.beginPath();
  chartCtx.moveTo(28, targetY);
  chartCtx.lineTo(w, targetY);
  chartCtx.stroke();
  chartCtx.setLineDash([]);
  chartCtx.fillStyle = "#a3bd8c";
  chartCtx.font = "11px system-ui";
  chartCtx.fillText(
    `Target ${config.tolerance}%`,
    w - 85,
    Math.max(12, targetY - 5),
  );
  chartCtx.fillStyle = "#919d85";
  chartCtx.font = "11px system-ui";
  chartCtx.fillText(`${Math.ceil(max)}%`, 0, 13);
  chartCtx.fillText("0", 10, h - 3);
  const first = history[0]?.time ?? 0,
    last = history.at(-1)?.time ?? 1,
    span = Math.max(1000, last - first);
  chartCtx.strokeStyle = "#b6f36b";
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  let pen = false;
  for (const f of history) {
    const value = f.metrics?.deviation;
    if (value == null) {
      pen = false;
      continue;
    }
    const x = 28 + ((f.time - first) / span) * (w - 30),
      y = h - 4 - (value / max) * (h - 20);
    if (pen) chartCtx.lineTo(x, y);
    else chartCtx.moveTo(x, y);
    pen = true;
  }
  chartCtx.stroke();
}
function acceptFrame(f, image = null) {
  current = f;
  if (lastImage && lastImage !== image) lastImage.close?.();
  lastImage = image;
  $("empty-state").hidden = true;
  $("stage-badge").hidden = f.source !== "demo" && !replay;
  $("stage-badge").textContent = replay
    ? "ANALYSIS REPLAY · NO VIDEO"
    : "DEMO · GENERATED MOTION";
  $("source-label").textContent = replay
    ? "SESSION REVIEW"
    : f.source === "demo"
      ? "DEMO · GENERATED MOTION"
      : localMode ? "LIVE FROM YOUR PC CAMERA" : "LIVE FROM YOUR PHONE";
  $("live-dot").style.background = f.source === "demo" ? "#b5a3ff" : "#b6f36b";
  const good = f.staffs.filter((s) => s && s.confidence >= 0.55).length;
  $("tracking-label").textContent =
    good === 2
      ? "Both staves tracked" +
        (f.metrics.deviation == null
          ? ""
          : f.metrics.deviation <= config.tolerance
            ? " · within target"
            : " · outside target")
      : `${good} / 2 staves visible · scores paused`;
  $("camera-info").textContent = replay
    ? `Sample at ${(f.elapsedMs / 1000).toFixed(2)}s`
    : `${f.status ?? "Phone camera"} · ${Math.round(f.analysisFps ?? 0)} analysis fps` + (localMode ? ` · ${Math.round(f.cameraFps || 0)} camera fps` : f.source === "demo" ? "" : ` · ${Math.round(previewFps)} preview fps`);
  $("record").classList.toggle("recording", !!f.recording);
  $("record").textContent = f.finalizing
    ? "Saving…"
    : f.recording
      ? `■ Stop · ${Math.floor(f.elapsedMs / 1000)}s`
      : "● Record practice";
  trail.push(f);
  trail = trail.filter((t) => f.time - t.time < 4200).slice(-135);
  render(f, image);
  if (f.zoom && document.activeElement !== $("zoom")) {
    $("zoom").min = f.zoom.min; $("zoom").max = f.zoom.max; $("zoom").value = f.zoom.ratio;
    $("zoom").disabled = !f.cameraReady || f.zoom.min === f.zoom.max || !!replay;
    document.querySelector('output[for="zoom"]').textContent = `${f.zoom.ratio.toFixed(2)}×`;
  }
  setCoaching(f);
  setMetrics(f.metrics);
  if (!replay) {
    history.push(f);
    history = history.filter((t) => f.time - t.time < 30000).slice(-900);
  }
  drawChart();
  enableControls();
}
async function loadSessions() {
  if (!paired && !localMode) return;
  try {
    const { sessions } = localMode ? { sessions: await localCamera.sessions() } : await api("/api/sessions");
    $("sessions").replaceChildren();
    if (!sessions.length)
      $("sessions").append(
        Object.assign(document.createElement("p"), {
          className: "small-note",
          textContent:
            "No recordings yet. Your first session will appear here.",
        }),
      );
    for (const s of sessions) {
      const card = document.createElement("div");
      card.className = "session";
      card.textContent = new Date(s.createdAt).toLocaleString();
      card.append(
        Object.assign(document.createElement("small"), {
          textContent: `${Math.round(s.durationMs / 1000)}s · ${s.validFrames} scored samples${s.recordingError != null ? " · recording error" : ""}`,
        }),
      );
      const review = Object.assign(document.createElement("button"), {
        textContent: "Review",
      });
      review.onclick = async () => {
        try {
          if (localMode) { loadAnalysis(await (await localCamera.session(s.id)).analysis.text()); return; }
          const r = await fetch(`/api/session?id=${encodeURIComponent(s.id)}`);
          if (!r.ok) throw new Error("Cannot load analysis");
          loadAnalysis(await r.text());
        } catch (e) {
          message(e.message);
        }
      };
      const download = Object.assign(document.createElement("a"), {
        href: `/api/session?id=${encodeURIComponent(s.id)}`,
        textContent: "Export ↗",
        download: `${s.id}.jsonl`,
      });
      if (localMode) {
        download.removeAttribute("href"); download.setAttribute("role", "button"); download.tabIndex = 0;
        download.onclick = async () => downloadBlob((await localCamera.session(s.id)).analysis, `${s.id}.jsonl`);
        download.onkeydown = e => { if (e.key === "Enter") download.click(); };
        const play = Object.assign(document.createElement("button"), { textContent: "Play video" });
        play.onclick = async () => { const session = await localCamera.session(s.id); sessionVideoUrl = URL.createObjectURL(session.video); $("session-video").src = sessionVideoUrl; $("video-dialog").showModal(); $("session-video").play().catch(() => {}); };
        const save = Object.assign(document.createElement("button"), { textContent: "Download video" });
        save.onclick = async () => { const session = await localCamera.session(s.id); downloadBlob(session.video, `${s.id}.${session.mimeType.includes("mp4") ? "mp4" : "webm"}`); };
        card.append(play, save);
      }
      card.append(review, download);
      $("sessions").append(card);
    }
  } catch (e) {
    message(e.message);
  }
}
$("refresh-sessions").onclick = loadSessions;
function loadAnalysis(text) {
  if (text.length > 30_000_000)
    throw new Error("Analysis export is too large (30 MB limit).");
  const rows = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (rows[0]?.type !== "header" || rows[0]?.schema !== 1)
    throw new Error("Choose a Klobflow analysis export.");
  const frames = rows.slice(1);
  if (!frames.length)
    throw new Error("This session contains no measured frames.");
  for (const f of frames) {
    if (
      !Number.isFinite(f.time) ||
      !Number.isFinite(f.width) ||
      !Number.isFinite(f.height) ||
      f.width < 1 ||
      f.height < 1 ||
      f.width > 8192 ||
      f.height > 8192 ||
      !Array.isArray(f.staffs) ||
      f.staffs.length !== 2 ||
      !f.guide ||
      !f.config ||
      !f.metrics
    )
      throw new Error("Invalid analysis frame.");
  }
  stopStream();
  replay = frames;
  updateSourceControls();
  history = frames;
  trail = [];
  $("scrubber").max = String(frames.length - 1);
  $("scrubber").value = "0";
  $("replay-control").hidden = false;
  $("return-live").hidden = false;
  $("chart-source").textContent = "RECORDED SESSION";
  showReplay(0);
  message(
    localMode ? "Showing saved analysis. Use Play video in the practice log for the recording." : "Showing saved analysis. The matching video is on the phone in Movies / Klobflow.",
  );
  enableControls();
}
function showReplay(index) {
  const f = replay[index];
  trail = replay.slice(Math.max(0, index - 135), index).filter(f => replay[index].time - f.time < 4200);
  syncConfig(f.config);
  acceptFrame(f);
  document.querySelector('output[for="scrubber"]').textContent =
    `${index + 1} / ${replay.length}`;
}
$("import-analysis").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 30_000_000)
      throw new Error("Choose an export under 30 MB.");
    loadAnalysis(await file.text());
  } catch (err) {
    message(err.message);
  }
  e.target.value = "";
};
$("scrubber").oninput = (e) => showReplay(Number(e.target.value));
$("return-live").onclick = () => {
  replay = null;
  updateSourceControls();
  trail = [];
  history = [];
  lastTime = null;
  $("replay-control").hidden = true;
  $("return-live").hidden = true;
  $("chart-source").textContent = "LAST 30 SECONDS";
  message("");
  if (!paired && !demo && !localMode) resetView();
  enableControls();
};
function stopStream() {
  streamController?.abort(); streamController = null; nextStreamAt = 0;
}
async function receiveStream() {
  const controller = new AbortController(); streamController = controller;
  const decoder = new FrameDecoder();
  let pending = null, drawing = false;
  const drawLatest = async () => {
    if (drawing) return;
    drawing = true;
    try {
      while (pending && !controller.signal.aborted) {
        const packet = pending; pending = null;
        const image = await createImageBitmap(new Blob([packet.jpeg], { type: "image/jpeg" }));
        if (controller.signal.aborted) { image.close(); break; }
        const now = performance.now(); arrivals.push(now); arrivals = arrivals.filter(t => now - t < 1500);
        previewFps = arrivals.length > 1 ? (arrivals.length - 1) * 1000 / (now - arrivals[0]) : 0;
        syncConfig(packet.frame.currentConfig || packet.frame.config);
        acceptFrame(packet.frame, image);
        if (packet.frame.error) message(packet.frame.error);
      }
    } catch (e) { if (!controller.signal.aborted) message(e.message); }
    finally { drawing = false; }
  };
  try {
    const response = await fetch("/api/stream", { signal: controller.signal });
    if (!response.ok) throw new Error((await response.json()).error || "Camera stream unavailable");
    message("");
    const reader = response.body.getReader();
    while (!controller.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Camera paused. Reopen Klobflow to resume.");
      const packets = decoder.push(value);
      if (packets.length) {
        pending = packets.at(-1); lastArrival = Date.now(); drawLatest();
      }
    }
  } catch (e) {
    if (!controller.signal.aborted) {
      setMetrics(null); setCoaching(null);
      $("tracking-label").textContent = "Reconnecting · reopen Klobflow on your phone";
      $("source-label").textContent = "CAMERA PAUSED";
      $("record").disabled = true; message(e.message);
    }
  } finally {
    controller.abort();
    if (streamController === controller) { streamController = null; nextStreamAt = Date.now() + 1000; }
  }
}
function loop() {
  if (!replay && demo) acceptFrame(demoFrame(config, performance.now()));
  if (paired && !replay && !streamController && Date.now() >= nextStreamAt) receiveStream();
  if ((paired || (localMode && localCamera.active)) && !replay && !seeding && !calibrating && Date.now() - lastArrival > 2000) {
    setMetrics(null); setCoaching(null); $("record").disabled = true;
    $("tracking-label").textContent = "Waiting for fresh camera frames…";
  }
  if (localMode && !replay) canvas.style.opacity = Date.now() - lastArrival > 200 ? "0" : "1";
  else canvas.style.opacity = "1";
  setTimeout(loop, 33);
}
syncConfig(config);
enableControls();
drawEmpty();
drawChart();
api("/api/status")
  .then((s) => {
    if (s.paired) {
      transport = s.transport;
      connected(true);
      loadSessions();
    } else {
      try { if (localStorage.getItem("klobflow.lastMode") === "local") navigator.permissions?.query({name:"camera"}).then(p => { if (p.state === "granted") startLocal(); }).catch(() => {}); } catch {}
    }
  })
  .catch((e) => message(e.message));
loop();
