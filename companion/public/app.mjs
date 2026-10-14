import { defaults, demoFrame } from "./demo.mjs";
const $ = (id) => document.getElementById(id);
const canvas = $("view"),
  ctx = canvas.getContext("2d"),
  chart = $("chart"),
  chartCtx = chart.getContext("2d");
let config = { ...defaults },
  paired = false,
  demo = false,
  replay = null,
  current = null,
  lastTime = null,
  lastArrival = 0,
  seeding = false,
  picks = [],
  lastImage = null;
let trail = [],
  history = [];
const descriptions = {
  grid: "Trace clean lines through the grid. Error measures tip distance to the nearest guide line.",
  circles:
    "Follow overlapping circles. Error measures tip distance from the nearest circumference.",
  cube: "Align staff tips with cube vertices. This is a projected reference, not a measurement of 3D depth.",
  free: "Move freely. Track staves and explore your trails without a grid-alignment score.",
};
async function api(route, body) {
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
      value ? "PHONE CONNECTED" : demo ? "DEMO MODE" : "PHONE NOT CONNECTED",
    ),
  );
  $("pair-open").textContent = value ? "Disconnect" : "Connect phone ↗";
  enableControls();
}
function enableControls() {
  document
    .querySelectorAll("[data-config], [data-mode]")
    .forEach((e) => (e.disabled = !(paired || demo) || !!replay));
  $("reset").disabled = !paired || !!replay;
  $("seed").disabled = !paired || !!replay;
  $("record").disabled =
    !paired ||
    !!replay ||
    current?.source === "demo" ||
    !current?.cameraReady ||
    current?.finalizing;
}
function syncConfig(c) {
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
  $("phone-address").focus();
}
$("pair-open").onclick = async () => {
  if (paired) {
    await api("/api/disconnect", {});
    connected(false);
    resetView();
  } else openPair();
};
$("connect-stage").onclick = openPair;
$("cancel-pair").onclick = () => $("pair-dialog").close();
$("pair-form").onsubmit = async (e) => {
  e.preventDefault();
  $("pair-submit").disabled = true;
  $("pair-error").textContent = "";
  try {
    await api("/api/pair", {
      address: $("phone-address").value.trim(),
      token: $("phone-token").value.trim(),
    });
    $("phone-token").value = "";
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
  picks = [];
  $("empty-state").hidden = false;
  $("stage-badge").hidden = true;
  $("tracking-label").textContent = "Waiting for your phone";
  $("source-label").textContent = "YOUR PRACTICE VIEW";
  $("live-dot").style.background = "";
  $("seed-message").hidden = true;
  setMetrics(null);
  drawEmpty();
  drawChart();
}
$("demo-start").onclick = () => {
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
        ? "Recording on your phone. Video and analysis save locally."
        : "Saving your practice on the phone.",
    );
  } catch (e) {
    message(e.message);
  } finally {
    enableControls();
  }
};
$("seed").onclick = () => {
  seeding = !seeding;
  picks = [];
  $("seed").textContent = seeding ? "Cancel selection" : "Identify staves";
  $("seed-message").hidden = !seeding;
  $("seed-message").textContent = "Hold staves still. Tap staff A, end 1.";
};
canvas.addEventListener("click", async (e) => {
  if (!seeding || !current) return;
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
  if (picks.length === 4) {
    try {
      await api("/api/control", { action: "seed", points: picks });
      trail = [];
      message("Staff selection applied. Move slowly while tracking settles.");
    } catch (err) {
      message(err.message);
    }
    seeding = false;
    picks = [];
    $("seed-message").hidden = true;
    $("seed").textContent = "Identify staves";
  } else
    $("seed-message").textContent =
      `Hold still. Tap staff ${picks.length < 2 ? "A" : "B"}, end ${(picks.length % 2) + 1}.`;
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
  canvas.width = frame.width;
  canvas.height = frame.height;
  const w = canvas.width,
    h = canvas.height,
    u = Math.min(w, h),
    g = frame.guide,
    c = frame.config;
  ctx.fillStyle = "#0a100c";
  ctx.fillRect(0, 0, w, h);
  if (image) ctx.drawImage(image, 0, 0, w, h);
  else {
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
        ctx.globalAlpha = ((i + 1) / trail.length) * 0.45;
        ctx.fillStyle = n ? "#b5a3ff" : "#b6f36b";
        for (const p of [s.a, s.b]) {
          ctx.beginPath();
          ctx.arc(p[0] * u, p[1] * u, 2.5, 0, Math.PI * 2);
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
      `${n ? "B" : "A"}  ${Math.round(s.confidence * 100)}%`,
      s.a[0] * u + 10,
      s.a[1] * u - 10,
    );
  });
  ctx.globalAlpha = 1;
  for (const p of picks) {
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.arc(p[0] * w, p[1] * h, 8, 0, Math.PI * 2);
    ctx.stroke();
  }
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
      : "LIVE FROM YOUR PHONE";
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
    : `${f.status ?? "Phone camera"} · ${Math.round(f.analysisFps ?? 0)} analysis fps`;
  $("record").classList.toggle("recording", !!f.recording);
  $("record").textContent = f.finalizing
    ? "Saving…"
    : f.recording
      ? `■ Stop · ${Math.floor(f.elapsedMs / 1000)}s`
      : "● Record practice";
  if (!seeding) {
    trail.push(f);
    trail = trail.filter((t) => f.time - t.time < 1400).slice(-45);
    render(f, image);
  }
  setMetrics(f.metrics);
  if (!replay) {
    history.push(f);
    history = history.filter((t) => f.time - t.time < 30000).slice(-900);
  }
  drawChart();
  enableControls();
}
async function loadSessions() {
  if (!paired) return;
  try {
    const { sessions } = await api("/api/sessions");
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
  replay = frames;
  history = frames;
  trail = [];
  $("scrubber").max = String(frames.length - 1);
  $("scrubber").value = "0";
  $("replay-control").hidden = false;
  $("return-live").hidden = false;
  $("chart-source").textContent = "RECORDED SESSION";
  showReplay(0);
  message(
    "Showing saved analysis. The matching video is on the phone in Movies / Klobflow.",
  );
  enableControls();
}
function showReplay(index) {
  const f = replay[index];
  trail = replay.slice(Math.max(0, index - 35), index);
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
  trail = [];
  history = [];
  lastTime = null;
  $("replay-control").hidden = true;
  $("return-live").hidden = true;
  $("chart-source").textContent = "LAST 30 SECONDS";
  message("");
  if (!paired && !demo) resetView();
  enableControls();
};
async function loop() {
  try {
    if (!replay && demo) {
      const f = demoFrame(config, performance.now());
      acceptFrame(f);
    } else if (paired && !replay) {
      const f = await api("/api/live");
      if (f.time && f.time !== lastTime && f.image) {
        lastTime = f.time;
        lastArrival = Date.now();
        const image = new Image();
        image.src = `data:image/jpeg;base64,${f.image}`;
        await image.decode();
        syncConfig(f.currentConfig ?? f.config);
        acceptFrame(f, image);
        if (f.error) message(f.error);
      } else if (Date.now() - lastArrival > 2000) {
        setMetrics(null);
        $("tracking-label").textContent = "Waiting for fresh camera frames…";
        $("source-label").textContent = "CAMERA PAUSED";
        $("record").disabled = true;
      }
    }
  } catch (e) {
    if (paired) {
      setMetrics(null);
      $("tracking-label").textContent =
        "Connection interrupted · showing last frame";
      $("source-label").textContent = "DISCONNECTED";
      $("record").disabled = true;
      message(e.message);
    }
  } finally {
    setTimeout(loop, 100);
  }
}
syncConfig(config);
enableControls();
drawEmpty();
drawChart();
api("/api/status")
  .then((s) => {
    if (s.paired) {
      connected(true);
      loadSessions();
    }
  })
  .catch((e) => message(e.message));
loop();
