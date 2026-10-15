import {openCamera, optimizeCamera, cameraError} from '/camera.mjs';
import {FrameDecoder} from '/stream.mjs';
import {drawFrame, canvasPoint, encodeFrame, orientedBitmap, imageCorners, cornerProblem, formatClock} from '/view.mjs';

const $ = id => document.getElementById(id);
const video = $('sourceVideo'), view = $('view'), live = $('live');
const message = text => { $('message').textContent = text; };
const mirrored = () => $('mirror').checked;
const names = {camera: 'PC camera', phone: 'Phone', file: 'Recording'};
const cornerNames = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];

// One source at a time. Every change bumps `generation`; frames, phone packets and
// model replies that belong to an older generation are dropped, never drawn.
let generation = 0, source = '', opening = '', settling = false, abort = null;
let stream = null, fileUrl = null, phoneFrame = null, phoneCamera = '', frameCallback = null, raf = 0, lastVideoTime = -1, frameStep = 1 / 30, shownTime = 0;
// Modes: idle → live → preparing → selecting → starting → tracking. Estimates are
// drawn only on `analysed.image`, the exact JPEG the model returned with them.
let mode = 'idle', selection = null, starting = null, analysed = null, corrected = null, history = [], held = {};
let link = null, pumping = null, frameId = 0, modelReady = false, modelError = '';
let geometry = {lens: null, corners: null, aspect: 1}, previewProblem = '', boardViews = 0, lensNote = '', planeNote = '';
// Geometry to restore if a new corner selection is abandoned.
let planeBackup = null;
const stats = {frames: 0, since: 0, fps: 0, lastFrame: 0, results: [], delay: 0, inference: 0};
const geometryActive = () => Boolean(geometry.lens || geometry.corners);

// ---- Local model link ------------------------------------------------------
// The server answers strictly in request order, so each reply settles the oldest
// outstanding request. Errors carry no frame id; their position identifies them.
function connect() {
  if (link) return link.ready;
  const own = {ws: new WebSocket(`ws://${location.host}/ws/track`), queue: [], open: false};
  own.ws.binaryType = 'arraybuffer';
  link = own;
  own.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { own.refusal = 'The local model did not answer'; own.ws.close(); }, 12000);
    own.ws.onmessage = event => {
      if (!own.open) {
        clearTimeout(timer);
        const reply = typeof event.data === 'string' ? JSON.parse(event.data) : {};
        if (reply.type === 'ready') { own.open = true; resolve(); } else own.refusal = reply.error;
        return;
      }
      const request = own.queue.shift();
      if (!request) return;
      let reply;
      try { reply = typeof event.data === 'string' ? JSON.parse(event.data) : new FrameDecoder().push(new Uint8Array(event.data))[0]; } catch {}
      if (reply?.type === 'error') request.reject(Error(reply.error));
      else if (request.expect === 'frame' ? reply?.jpeg : reply?.type === request.expect) request.resolve(reply);
      else { request.reject(Error('The motion server sent an unexpected reply')); own.ws.close(); }
    };
    own.ws.onclose = () => {
      clearTimeout(timer);
      for (const request of own.queue.splice(0)) request.reject(Object.assign(Error('The connection to the local model closed'), {closed: true}));
      if (link === own) {
        link = null;
        if (own.open) linkLost();
      }
      if (!own.open) reject(Error(own.refusal || 'Could not reach the local motion server'));
    };
  });
  return own.ready;
}
async function ensureLink() {
  for (let attempt = 0; ; attempt++) {
    try { await connect(); break; } catch (error) {
      // The server frees a closed connection (a stopped source or a reload) after
      // its current inference. Retry briefly; a genuinely busy tab keeps the message.
      if (!/another tab/.test(error.message) || attempt >= 12) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  if (!link?.open) throw Error('The connection to the local model closed');
  if (!link.configured) {
    link.configured = true;
    // A replacement connection starts without geometry. Restore the active one.
    if (geometryActive()) await command({type: 'geometry', ...geometry}, 'geometry').catch(error => {
      geometry = {lens: null, corners: null, aspect: geometry.aspect}; lensNote = planeNote = '';
      throw Error(`Camera geometry could not be restored, so it was cleared · ${error.message}`);
    });
  }
}
function closeLink() {
  const own = link;
  if (!own) return;
  link = null; own.ws.close();
}
function request(payload, expect) {
  return new Promise((resolve, reject) => {
    if (!link?.open) return reject(Error('The local model is not connected'));
    link.queue.push({resolve, reject, expect});
    link.ws.send(payload);
  });
}
const command = (body, expect) => request(JSON.stringify(body), expect);
function linkLost() {
  boardViews = 0;
  if (planeBackup) { geometry = planeBackup; planeBackup = null; }
  if (mode !== 'idle' && mode !== 'live') { endSelection(); endTracking(); mode = 'live'; }
  corrected?.image.close(); corrected = null;
  message('The connection to the local model closed. The live view keeps running. Select the staff again when ready.');
  render();
  // Reconnect once so a corrected view resumes; selection always reconnects anyway.
  const own = generation;
  if (geometryActive()) setTimeout(() => { if (own === generation && !link) ensureLink().then(render, () => {}); }, 1500);
}

// ---- Frames ------------------------------------------------------------------
function currentImage() {
  if (source === 'phone') return phoneFrame;
  return source && video.readyState >= 2 && video.videoWidth ? video : null;
}
async function grab() {
  const image = currentImage();
  if (!image) throw Error('Waiting for the first video frame');
  const width = image.videoWidth || image.width, height = image.videoHeight || image.height;
  const scale = Math.min(1, 960 / Math.max(width, height));
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const grabbedAt = performance.now();
  return {jpeg: await canvas.convertToBlob({type: 'image/jpeg', quality: .9}), time: grabbedAt / 1000, grabbedAt};
}
async function analyse(raw, {seed = null, previewOnly = false} = {}) {
  const id = ++frameId;
  const packet = await request(encodeFrame({id, time: raw.time, seed, previewOnly, calibrationCapture: false}, raw.jpeg), 'frame');
  if (packet.frame.id !== id) { closeLink(); throw Error('The motion server answered a different frame'); }
  const image = await createImageBitmap(new Blob([packet.jpeg], {type: 'image/jpeg'}));
  return {result: packet.frame, image, raw};
}
function frameArrived() {
  const now = performance.now();
  stats.frames++; stats.lastFrame = now;
  if (now - stats.since >= 1000) { stats.fps = stats.frames * 1000 / (now - stats.since); stats.frames = 0; stats.since = now; renderStats(); }
  pump();
}
// Analyse the newest frame once the previous reply is back. Frames that arrive
// meanwhile are skipped, so the live view never waits for the model.
async function pump() {
  const purpose = mode === 'tracking' ? 'tracking' : mode === 'live' && geometryActive() && !previewProblem ? 'live' : '';
  if (!purpose || pumping || !link?.open || settling) return;
  const own = generation, token = pumping = {};
  try {
    const raw = await grab();
    if (own !== generation || mode !== purpose) return;
    const reply = await analyse(raw, {previewOnly: purpose === 'live'});
    if (own !== generation || mode !== purpose) { reply.image.close(); return; }
    if (purpose === 'tracking') showResult(reply);
    else { const first = !corrected; corrected?.image.close(); corrected = reply; draw(); if (first) render(); }
  } catch (error) {
    // A closed link is reported once by linkLost(); it is not a problem with the frame.
    if (own === generation && mode === purpose && !error.closed) analysisFailed(error, purpose);
  } finally {
    if (pumping === token) pumping = null;
  }
}
function analysisFailed(error, purpose) {
  if (purpose === 'tracking') { endTracking(); mode = 'live'; message(`Tracking paused · ${error.message}`); }
  else { previewProblem = error.message; corrected?.image.close(); corrected = null; message(`The corrected view is unavailable · ${error.message}`); }
  render();
}
function showResult({result, image, raw}) {
  analysed?.image.close();
  analysed = {result, image};
  const now = performance.now(), delay = now - raw.grabbedAt;
  stats.results = [...stats.results.filter(time => now - time < 2000), now];
  stats.delay = stats.delay ? stats.delay * .8 + delay * .2 : delay;
  stats.inference = Number(result.inferenceMs) || 0;
  if (result.ends?.length === 2) history = [...history.filter(item => result.time - item.time <= 4), result];
  describe(result);
  draw();
  renderStats();
}

// ---- Readouts ----------------------------------------------------------------
const stateText = {visible: 'Image estimate', estimated: 'Inferred', outside: 'Inferred · out of view', waiting: 'Waiting'};
function pointState(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return 'waiting';
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return 'outside';
  return point.state === 'visible' ? 'visible' : 'estimated';
}
// Text follows the rings with a short hold, so labels never flicker frame to frame.
function hold(key, value, now) {
  const entry = held[key] ??= {value, next: value, since: now};
  if (value !== entry.next) { entry.next = value; entry.since = now; }
  if (entry.next !== entry.value && now - entry.since >= 1500) entry.value = entry.next;
  return entry.value;
}
function describe(result) {
  const now = performance.now(), ends = result.ends?.length === 2 ? result.ends : [];
  const states = {a: pointState(ends[0]), mid: pointState(ends.length ? result.midpoint : null), b: pointState(ends[1])};
  for (const key of ['a', 'mid', 'b']) {
    const state = hold(key, states[key], now);
    $(`${key}Row`).dataset.state = state; $(`${key}State`).textContent = stateText[state];
  }
  const visible = hold('visible', ends.length ? ends.filter(point => point.state === 'visible').length : -1, now);
  setReadout(visible < 0 ? 'No estimate in this frame' : ['Using motion estimates', 'One end inferred', 'Following staff shape'][visible],
    'Rings are model estimates and can drift. If one follows the wrong object, reselect the ends.');
}
function setReadout(title, detail) {
  if ($('trackingState').textContent !== title) $('trackingState').textContent = title;
  if ($('trackingDetail').textContent !== detail) $('trackingDetail').textContent = detail;
}
function setStat(id, text) {
  if ($(id).textContent !== text) $(id).textContent = text;
  $(id).hidden = !text;
}

// ---- Sources -----------------------------------------------------------------
function stopSource(note = '') {
  generation++; abort?.abort(); abort = null;
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  if (frameCallback !== null) video.cancelVideoFrameCallback?.(frameCallback);
  frameCallback = null; lastVideoTime = -1; frameStep = 1 / 30; shownTime = 0;
  video.onloadeddata = video.onerror = null;
  video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load();
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  fileUrl = null;
  cancelAnimationFrame(raf); raf = 0;
  closeLink(); pumping = null;
  phoneFrame?.close(); phoneFrame = null; phoneCamera = '';
  endSelection(); endTracking(); corrected?.image.close(); corrected = null;
  // Geometry and board views belong to one camera mode. A new source starts clean.
  geometry = {lens: null, corners: null, aspect: geometry.aspect}; planeBackup = null; previewProblem = ''; boardViews = 0; lensNote = planeNote = '';
  source = ''; opening = ''; settling = false; mode = 'idle';
  Object.assign(stats, {frames: 0, fps: 0, lastFrame: 0, results: [], delay: 0, inference: 0});
  if (note) message(note);
  render();
}
function beginSource(kind, note) {
  stopSource();
  abort = new AbortController(); opening = kind;
  message(note); render();
  return generation;
}
function sourceStarted(kind) {
  source = kind; opening = ''; mode = 'live';
  showPhoneForm(false);
  stats.since = performance.now(); stats.frames = 0;
  raf ||= requestAnimationFrame(tick);
  render();
}
function watchVideo(own, previous = -1) {
  if (own !== generation || !video.requestVideoFrameCallback) return;
  frameCallback = video.requestVideoFrameCallback((now, {mediaTime}) => {
    // The shortest gap between presented frames is the recording's frame duration.
    if (source === 'file' && previous >= 0 && mediaTime - previous > 1 / 240) frameStep = Math.min(frameStep, mediaTime - previous);
    shownTime = mediaTime;
    frameArrived(); watchVideo(own, mediaTime);
  });
}
async function useCamera() {
  const deviceId = $('cameraChoice').value, own = beginSource('camera', 'Opening the camera…'), signal = abort.signal;
  try {
    const opened = await openCamera({deviceId, signal, onProgress: message});
    if (own !== generation) { opened.getTracks().forEach(track => track.stop()); return; }
    stream = opened; video.srcObject = stream;
    await video.play();
    if (own !== generation) return;
    const track = stream.getVideoTracks()[0];
    track.addEventListener('ended', () => { if (own === generation) stopSource('The camera disconnected. Reconnect it, then choose Use PC camera.'); });
    // Selection waits for the profile probe: it changes resolution while it measures.
    settling = true; sourceStarted('camera'); watchVideo(own);
    const {selected} = await optimizeCamera(track, video, {signal, onProgress: message});
    if (own !== generation) return;
    settling = false;
    listCameras(track.getSettings().deviceId);
    message(`Camera ready · ${selected.width} × ${selected.height} at ${Math.round(selected.measuredFps)} fps measured. Hold the staff still, then select its two ends.`);
    render();
  } catch (error) {
    if (own === generation) stopSource(cameraError(error));
  }
}
async function listCameras(selected = $('cameraChoice').value) {
  const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || [];
  const cameras = devices.filter(device => device.kind === 'videoinput' && device.deviceId);
  if (!cameras.some(camera => camera.label)) return;
  $('cameraChoice').replaceChildren(...cameras.map((camera, i) => new Option(camera.label || `Camera ${i + 1}`, camera.deviceId)));
  if (cameras.some(camera => camera.deviceId === selected)) $('cameraChoice').value = selected;
}
async function usePhone(transport) {
  const address = $('address').value.trim();
  if (transport === 'lan') {
    if (!address) { message('Enter the phone address shown in the Klobflow Android app.'); $('address').focus(); return; }
    try { localStorage.setItem('klobflow.motion.phone', address); } catch {}
  }
  const own = beginSource('phone', `Connecting to the phone over ${transport === 'usb' ? 'USB' : 'Wi-Fi'}…`), signal = abort.signal;
  let connectedOnce = false;
  while (own === generation) {
  const attempt = new AbortController(), combined = AbortSignal.any([signal, attempt.signal]);
  let acceptPackets = true, idleTimer;
  const armTimeout = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => attempt.abort(), 20000); };
  try {
    armTimeout();
    const response = await fetch(`/api/phone-stream?${new URLSearchParams({transport, address})}`, {signal: combined});
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Error(body.detail || body.error || `The phone connection failed (${response.status})`);
    }
    const reader = response.body.getReader(), decoder = new FrameDecoder();
    let latest = null, decoding = false;
    // Decode only the newest packet; older ones are skipped instead of queued.
    const decodeLatest = async () => {
      if (decoding) return;
      decoding = true;
      try {
        while (latest && own === generation && acceptPackets) {
          const packet = latest; latest = null;
          const config = packet.frame.currentConfig || packet.frame.config || {};
          const image = await orientedBitmap(packet.jpeg, packet.frame.mirrored === true || config.mirror === true);
          if (own !== generation || !acceptPackets) { image.close(); return; }
          const camera = packet.frame.camera || {}, zoom = packet.frame.zoom?.ratio ?? config.zoom ?? '';
          const signature = JSON.stringify([config.facing, zoom, camera.physicalId, camera.rotation,
            camera.focalLengthMm ? Number(camera.focalLengthMm).toFixed(2) : '', camera.distortionCorrectionMode,
            image.width, image.height]);
          connectedOnce = true;
          phoneArrived(image, signature);
        }
      } catch (error) {
        if (own === generation) { message(error.message); attempt.abort(); }
      } finally { decoding = false; }
    };
    while (own === generation) {
      const {value, done} = await reader.read();
      if (done) throw Error('The phone feed ended. Turn on camera sharing in the Android app, then reconnect.');
      armTimeout();
      const packets = decoder.push(value);
      if (packets.length) { latest = packets.at(-1); decodeLatest(); }
    }
  } catch (error) {
    if (own !== generation) return;
    if (!connectedOnce) { stopSource(error.name === 'AbortError' ? 'The phone did not send video. Open the app and enable sharing, then reconnect.' : error.message); return; }
    phoneChanged(); closeLink(); pumping = null;
    phoneFrame?.close(); phoneFrame = null; phoneCamera = '';
    source = ''; opening = 'phone'; mode = 'idle';
    cancelAnimationFrame(raf); raf = 0;
    message('Waiting for the phone. Reopen the app with sharing on; video will reconnect automatically.');
    render();
  } finally {
    acceptPackets = false; clearTimeout(idleTimer); attempt.abort();
  }
  if (own === generation) await new Promise(resolve => {
    const timer = setTimeout(done, 2000);
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
    signal.addEventListener('abort', done, {once: true});
  });
  }
}
function phoneArrived(image, camera) {
  phoneFrame?.close(); phoneFrame = image;
  if (source !== 'phone') {
    phoneCamera = camera; sourceStarted('phone');
    message('Phone connected. Hold the staff still, then select its two ends.');
  } else if (camera !== phoneCamera) {
    phoneCamera = camera;
    phoneChanged();
  }
  frameArrived();
}
// A different phone camera, zoom or frame size invalidates the selection and geometry.
function phoneChanged() {
  const affected = mode !== 'live' || geometryActive() || boardViews > 0;
  endSelection(); endTracking(); corrected?.image.close(); corrected = null; mode = 'live';
  if (link?.open && geometryActive()) command({type: 'geometry', lens: null, corners: null, aspect: geometry.aspect}, 'geometry').catch(() => {});
  if (link?.open && boardViews) command({type: 'clearCalibration'}, 'calibrationCapture').catch(() => {});
  geometry = {lens: null, corners: null, aspect: geometry.aspect}; planeBackup = null; previewProblem = ''; boardViews = 0; lensNote = planeNote = '';
  if (affected) message('The phone camera, zoom or frame size changed. Geometry was cleared. Select the staff again.');
  render();
}
async function useFile(file) {
  const own = beginSource('file', `Opening ${file.name}…`), signal = abort.signal;
  try {
    fileUrl = URL.createObjectURL(file); video.src = fileUrl;
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(Error('This browser cannot play that video. Try MP4 (H.264) or WebM.'));
      signal.addEventListener('abort', resolve, {once: true});
    });
    if (own !== generation) return;
    video.onloadeddata = video.onerror = null;
    video.playbackRate = Number($('playback').value);
    sourceStarted('file'); watchVideo(own);
    message(`Opened ${file.name}. Pause where the staff is still, then select its two ends.`);
  } catch (error) {
    if (own === generation) stopSource(error.message);
  }
}
function tick() {
  raf = 0;
  if (!source) return;
  const image = currentImage(), now = performance.now();
  if (image) {
    if (showsLive()) drawFrame(view, image, {mirror: mirrored()});
    if (!$('livePreview').hidden) drawFrame(live, image, {mirror: mirrored(), maxWidth: 400});
  }
  if (source === 'file') {
    if (!video.requestVideoFrameCallback && video.currentTime !== lastVideoTime) { lastVideoTime = video.currentTime; frameArrived(); }
    renderPlayback();
  }
  if (now - stats.since >= 1500) { stats.fps = stats.frames * 1000 / (now - stats.since); stats.frames = 0; stats.since = now; renderStats(); }
  raf = requestAnimationFrame(tick);
}

// ---- Selection -----------------------------------------------------------------
// The still frame is the server's corrected JPEG; the seed is sent with the raw
// frame it came from, so geometry is applied once and clicks match the image.
async function select(kind = 'staff') {
  if (!source) { message('Start a camera, connect your phone, or open a recording first.'); return; }
  if (settling) { message('The camera is still being set up. Selection unlocks in a few seconds.'); return; }
  // A corner selection holds the previous plane until it finishes or is canceled.
  if (mode === 'preparing' || (mode === 'selecting' && selection.kind === 'plane')) return;
  if (!modelReady) { message(modelError ? `The vision model is unavailable · ${modelError}` : 'The local vision model is still loading. The live view keeps running.'); return; }
  const own = generation;
  planeBackup = kind === 'plane' && geometry.corners ? geometry : null;
  endSelection(); endTracking();
  if (source === 'file') video.pause();
  mode = 'preparing'; render();
  // Selection can start from the geometry panel further down; the still frame must be on screen.
  $('stage').scrollIntoView({block: 'nearest'});
  try {
    await ensureLink();
    // Reference corners are chosen on the lens-corrected view, before any plane correction.
    if (planeBackup) await configure({...geometry, corners: null});
    if (own !== generation || mode !== 'preparing') return;
    const raw = await grab();
    const reply = await analyse(raw, {previewOnly: true});
    if (own !== generation || mode !== 'preparing') { reply.image.close(); return; }
    selection = {kind, points: [], image: reply.image, raw, cursor: null, mirror: mirrored()};
    mode = 'selecting';
    render();
    view.focus({preventScroll: true});
  } catch (error) {
    if (own !== generation || mode !== 'preparing') return;
    mode = 'live'; message(error.message); restorePlane(); render();
  }
}
function restorePlane() {
  const backup = planeBackup;
  planeBackup = null;
  if (!backup) return;
  // Without a connection, keep it here; the next connection sends it again.
  if (!link?.open) { geometry = backup; render(); return; }
  configure(backup).catch(error => message(`The previous viewing angle could not be restored · ${error.message}`));
}
function place(point) {
  if (mode !== 'selecting') return;
  const limit = selection.kind === 'staff' ? 2 : 4;
  if (selection.points.length >= limit) return;
  selection.points.push(point); selection.problem = '';
  if (selection.points.length < limit) { render(); return; }
  if (selection.kind === 'staff') follow(); else applyCorners();
}
async function follow() {
  const own = generation, {raw, points, image} = selection;
  selection = null; starting = {image, points}; mode = 'starting'; held = {};
  render();
  try {
    const reply = await analyse(raw, {seed: points});
    if (own !== generation || mode !== 'starting') { reply.image.close(); return; }
    starting.image.close(); starting = null; history = []; mode = 'tracking';
    showResult(reply);
    message('Following the two ends you selected. Dashed rings are model estimates, including while an end is hidden.');
    if (source === 'file') video.play().catch(() => {});
    render();
  } catch (error) {
    if (own !== generation || mode !== 'starting') return;
    endSelection(); mode = 'live';
    message(`The model could not start from that selection · ${error.message}`);
    render();
  }
}
async function applyCorners() {
  const {points, image, mirror} = selection, corners = imageCorners(points, mirror), problem = cornerProblem(corners);
  if (problem) { selection.points = []; selection.problem = problem; render(); return; }
  image.close(); selection = null; mode = 'live';
  render();
  try {
    await configure({lens: geometry.lens, corners, aspect: planeAspect()});
    planeBackup = null; planeNote = 'Viewing angle corrected from your reference corners.';
    message('Viewing angle applied. The main view shows the corrected plane. Select the staff again.');
  } catch (error) {
    message(`Viewing angle not applied · ${error.message}`);
    restorePlane();
  }
  render();
}
function cancelSelection(note = 'Selection canceled.') {
  if (mode !== 'selecting' && mode !== 'preparing') return;
  endSelection(); mode = 'live';
  message(note); restorePlane(); render();
}
function undoPoint() {
  if (mode !== 'selecting' || !selection.points.length) return;
  selection.points.pop(); render();
}
function endSelection() {
  selection?.image.close(); selection = null;
  starting?.image.close(); starting = null;
}
function endTracking() {
  analysed?.image.close(); analysed = null; history = []; held = {};
  stats.results = []; stats.delay = 0; stats.inference = 0;
  for (const key of ['a', 'mid', 'b']) { $(`${key}Row`).dataset.state = 'waiting'; $(`${key}State`).textContent = 'Waiting'; }
}
const clamp01 = value => Math.min(1, Math.max(0, value));
function selectionKey(event) {
  const step = event.shiftKey ? .03 : .006;
  const moves = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]};
  if (event.key === 'Backspace') { undoPoint(); return true; }
  if (!(event.key in moves) && event.key !== 'Enter' && event.key !== ' ') return false;
  if (!selection.cursor) { selection.cursor = [.5, .5]; draw(); return true; }
  if (event.key in moves) {
    // Arrow keys move on screen. A mirrored view runs image x the other way.
    const [dx, dy] = moves[event.key];
    selection.cursor = [clamp01(selection.cursor[0] + (mirrored() ? -dx : dx)), clamp01(selection.cursor[1] + dy)];
    draw();
  } else place([...selection.cursor]);
  return true;
}

// ---- Geometry ------------------------------------------------------------------
async function configure(next) {
  await ensureLink();
  // The server resets the tracker for new geometry, so a running selection ends first.
  endTracking(); corrected?.image.close(); corrected = null;
  if (mode === 'tracking' || mode === 'starting') { endSelection(); mode = 'live'; }
  render();
  await command({type: 'geometry', lens: next.lens, corners: next.corners, aspect: next.aspect}, 'geometry');
  geometry = next; previewProblem = '';
  corrected?.image.close(); corrected = null;
  render();
}
function planeAspect() {
  const aspect = Number($('planeAspect').value);
  if (!(aspect >= .1 && aspect <= 10)) throw Error('Enter a width ÷ height ratio between 0.1 and 10');
  return aspect;
}
async function importLens(file) {
  if (file.size > 131072) throw Error('That file is too large to be a lens profile');
  let lens;
  try { lens = JSON.parse(await file.text()); } catch { throw Error('That file is not a lens profile'); }
  await configure({lens, corners: null, aspect: geometry.aspect});
  lensNote = 'Imported profile applied. Check that straight lines look straight.';
  message('Lens correction applied. The main view shows the corrected image. Select the staff again.');
  render();
}
async function captureBoard() {
  await ensureLink();
  if (mode === 'tracking' || mode === 'starting') { endSelection(); endTracking(); mode = 'live'; }
  const raw = await grab();
  const reply = await request(encodeFrame({id: ++frameId, time: raw.time, previewOnly: true, calibrationCapture: true}, raw.jpeg), 'calibrationCapture');
  boardViews = reply.count;
  message(boardViews < 8 ? `Board view ${boardViews} captured. Move or tilt the board, then capture again.` : `Board view ${boardViews} captured. Calculate the profile, or add views near the edges.`);
  render();
}
async function solveLens() {
  await ensureLink();
  message('Calculating the lens profile…');
  const reply = await command({type: 'calibrate', columns: 9, rows: 6, model: $('lensModel').value}, 'calibrated');
  await configure({lens: reply.profile, corners: null, aspect: geometry.aspect});
  lensNote = `Measured from ${reply.views} views · ${reply.rmsPixels.toFixed(2)} px reprojection error`;
  message('Lens profile measured and applied. Save it to reuse with this camera mode.');
  render();
}
async function clearBoard() {
  await ensureLink();
  await command({type: 'clearCalibration'}, 'calibrationCapture');
  boardViews = 0; render();
}
function saveLens() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(geometry.lens, null, 2)], {type: 'application/json'}));
  const anchor = Object.assign(document.createElement('a'), {href: url, download: 'klobflow-lens-profile.json'});
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Rendering -------------------------------------------------------------------
const showsLive = () => Boolean(source) && (((mode === 'live' || mode === 'preparing') && !corrected) || (mode === 'tracking' && $('smooth').checked));
function draw() {
  const mirror = mirrored(), image = currentImage();
  if (mode === 'selecting') drawFrame(view, selection.image, {mirror, selection});
  else if (mode === 'starting') drawFrame(view, starting.image, {mirror, selection: {kind: 'staff', points: starting.points}});
  else if (mode === 'tracking' && !$('smooth').checked && analysed) drawFrame(view, analysed.image, {mirror, result: analysed.result, history, trails: $('trails').checked});
  else if (corrected && (mode === 'live' || mode === 'preparing')) drawFrame(view, corrected.image, {mirror});
  else if (image) drawFrame(view, image, {mirror});
  else { view.width = 1280; view.height = 720; }
}
// Short prompt above the view while the user acts on a still frame.
function prompt() {
  if (mode === 'preparing') return ['Freezing a frame…', 'Keep holding the staff still'];
  if (mode === 'starting') return ['Starting…', 'Keep holding still until the rings appear'];
  const placed = selection.points.length;
  if (selection.kind === 'plane') return [`Click corner ${placed + 1} of 4 · ${cornerNames[placed]}`, selection.problem || 'As you see it on screen · Esc cancels'];
  return placed ? ['Click end B', 'The other glowing end · tracking starts right after'] : ['Click end A', 'The center of one glowing end · arrow keys + Enter also work · Esc cancels'];
}
function guidance() {
  if (opening) return ['Connecting…', opening === 'phone' ? 'Waiting for the first phone frame. This can take up to 20 seconds.' : 'Starting the source.'];
  if (!source) return ['No source yet', 'Start a camera, connect your phone, or open a recording.'];
  if (settling) return ['Setting up the camera', 'Measuring capture modes. Selection unlocks in a few seconds.'];
  if (mode === 'preparing') return ['Freezing a frame…', 'Keep holding the staff still.'];
  if (mode === 'selecting' && selection.kind === 'plane') return ['Selecting reference corners', `${selection.points.length} of 4 placed. The reference stays put, so take your time.`];
  if (mode === 'selecting') return ['Selecting the ends', `${selection.points.length} of 2 placed. Keep holding the staff still; tracking starts after the second click.`];
  if (mode === 'starting') return ['Starting…', 'Keep holding still until the rings appear.'];
  if (!modelReady) return ['Live view only', modelError ? `The vision model is unavailable · ${modelError}` : 'The local vision model is still loading. The live view keeps running.'];
  return ['Ready to select', source === 'file' ? 'Pause where the staff is still, then select its two ends.' : 'Hold the staff still in view, then select its two ends.'];
}
function viewLabel() {
  if (opening) return 'Connecting…';
  if (!source) return 'No source';
  if (mode === 'preparing') return 'Freezing a frame…';
  if (mode === 'selecting' || mode === 'starting') return 'Still frame';
  if (mode === 'tracking') return $('smooth').checked ? 'Live view · rings hidden' : 'Analysed frames';
  if (corrected) return 'Corrected view';
  return source === 'file' ? `Recording${video.paused ? ' · paused' : ''}` : `${names[source]} · live`;
}
function render() {
  const selecting = mode === 'selecting', following = mode === 'tracking' || mode === 'starting';
  const locked = mode === 'preparing' || selecting || mode === 'starting';
  $('stop').disabled = !source && !opening;
  $('empty').hidden = Boolean(source);
  $('selectStaff').hidden = selecting;
  $('selectStaff').disabled = !source || settling || !modelReady || mode === 'preparing';
  $('selectText').textContent = following ? 'Reselect staff ends' : 'Select staff ends';
  $('undoPoint').hidden = !selecting; $('undoPoint').disabled = !selection?.points.length;
  $('cancelSelection').hidden = !selecting && mode !== 'preparing';
  $('mirror').disabled = locked;
  view.classList.toggle('selecting', selecting);
  view.tabIndex = selecting ? 0 : -1;
  if (mode !== 'tracking') setReadout(...guidance());
  const label = viewLabel(), guide = mode === 'preparing' || selecting || mode === 'starting';
  $('viewLabel').textContent = label;
  $('instruction').hidden = !guide; $('message').hidden = guide;
  if (guide) {
    const [title, detail] = prompt();
    $('instructionTitle').textContent = title; $('instructionDetail').textContent = detail;
  }
  view.setAttribute('aria-label', selecting ? `Still frame. ${prompt()[0]}. Arrow keys move a cursor and Enter places the point.` : `Motion view · ${label}`);
  $('livePreview').hidden = !source || showsLive();
  renderStats(); renderPlayback(); renderGeometry();
  draw();
}
function renderStats() {
  const now = performance.now(), image = currentImage();
  const width = image?.videoWidth || image?.width, height = image?.videoHeight || image?.height;
  let cadence = '';
  if (source === 'phone' && now - stats.lastFrame > 2000) cadence = 'Phone · waiting for frames';
  else if (source && width) cadence = `${source === 'file' ? 'Recording' : 'Camera'} ${stats.fps >= 1 ? `${Math.round(stats.fps)} fps · ` : ''}${width} × ${height}`;
  setStat('cadence', cadence);
  stats.results = stats.results.filter(time => now - time < 2000);
  const count = stats.results.length, rate = count > 1 ? (count - 1) * 1000 / (stats.results[count - 1] - stats.results[0]) : 0;
  setStat('latency', mode === 'tracking' && count > 1 ? `Analysed ${rate.toFixed(rate < 10 ? 1 : 0)} fps · ${Math.round(stats.delay)} ms behind live` : '');
  $('latency').title = stats.inference ? `Model inference ${Math.round(stats.inference)} ms per frame, as reported by the motion server` : '';
}
function renderPlayback() {
  $('playbackBar').hidden = source !== 'file';
  if (source !== 'file') return;
  const locked = mode === 'preparing' || mode === 'selecting' || mode === 'starting', duration = video.duration;
  const play = video.paused ? 'Play' : 'Pause', clock = `${formatClock(video.currentTime)} / ${formatClock(duration)}`;
  if ($('playPause').textContent !== play) $('playPause').textContent = play;
  $('playPause').disabled = locked;
  $('seek').disabled = locked || !Number.isFinite(duration);
  if (Number.isFinite(duration) && $('seek').max !== String(duration)) $('seek').max = String(duration);
  if (document.activeElement !== $('seek')) $('seek').value = String(video.currentTime);
  if ($('clock').textContent !== clock) $('clock').textContent = clock;
}
function renderGeometry() {
  const ready = Boolean(source) && !settling && modelReady && !['preparing', 'selecting', 'starting'].includes(mode);
  for (const id of ['importLens', 'captureBoard', 'selectPlane']) $(id).disabled = !ready;
  $('clearLens').disabled = !ready || !geometry.lens;
  $('clearPlane').disabled = !ready || !geometry.corners;
  $('saveLens').disabled = !geometry.lens;
  $('solveLens').disabled = !ready || boardViews < 8;
  $('clearBoard').disabled = !ready || !boardViews;
  $('lensStatus').textContent = previewProblem && geometry.lens ? `Lens correction failed for this camera mode · ${previewProblem}` : geometry.lens ? lensNote || 'Lens correction applied' : 'No lens correction';
  $('planeStatus').textContent = geometry.corners ? planeNote || 'Viewing angle corrected' : 'Original viewing angle';
  $('boardCount').textContent = `${boardViews} ${boardViews === 1 ? 'view' : 'views'} captured${boardViews && boardViews < 8 ? ` · ${8 - boardViews} more needed` : ''}`;
}

// ---- Status, controls and keys -----------------------------------------------------
async function pollStatus() {
  let text, state;
  try {
    const status = await (await fetch('/api/status', {cache: 'no-store'})).json();
    modelReady = Boolean(status.ready); modelError = status.error || '';
    const device = String(status.device || '').startsWith('cuda') ? 'GPU' : 'CPU';
    state = status.ready ? 'ready' : status.error ? 'error' : 'loading';
    text = status.ready ? `${status.model} · local ${device}` : status.error ? 'Vision setup needed' : 'Loading local vision…';
    if (status.ready && status.busy && !link?.open) text = `${status.model} · open in another tab`;
    $('modelStatus').title = status.error || '';
  } catch {
    modelReady = false; state = 'error'; text = 'Motion server offline';
  }
  $('modelText').textContent = text; $('modelStatus').dataset.state = state;
  render();
}
function guarded(fn, prefix = '') {
  return async (...args) => {
    try { await fn(...args); } catch (error) { message(prefix ? `${prefix} · ${error.message}` : error.message); render(); }
  };
}
function showPhoneForm(open) {
  $('phoneForm').hidden = !open; $('lan').setAttribute('aria-expanded', String(open));
  if (!open) return;
  try { $('address').value ||= localStorage.getItem('klobflow.motion.phone') || ''; } catch {}
  $('address').focus();
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else $('workspace').requestFullscreen?.().catch(error => message(`Full screen is unavailable · ${error.message}`));
}
function flip(id) {
  if ($(id).disabled) return;
  $(id).checked = !$(id).checked; $(id).dispatchEvent(new Event('change'));
}
function playPause() {
  if (source !== 'file' || $('playPause').disabled) return;
  if (video.paused) video.play().catch(error => message(error.message)); else video.pause();
}
function stepFrame(direction) {
  if (source !== 'file' || !video.paused || $('seek').disabled) return;
  // Step from the frame on screen (currentTime can lag it after a pause) to the
  // middle of its neighbour, so rounding never lands back on the same frame.
  const shown = video.requestVideoFrameCallback ? shownTime : video.currentTime;
  const target = Math.min(video.duration, Math.max(0, shown + (direction + .5) * frameStep));
  shownTime = target - frameStep / 2;
  video.currentTime = target;
}

$('camera').onclick = useCamera;
$('usb').onclick = () => usePhone('usb');
$('lan').onclick = () => showPhoneForm($('phoneForm').hidden);
$('closePhone').onclick = () => { showPhoneForm(false); $('lan').focus(); };
$('phoneForm').onsubmit = event => { event.preventDefault(); usePhone('lan'); };
$('openFile').onclick = () => $('file').click();
$('file').onchange = () => { const file = $('file').files[0]; $('file').value = ''; if (file) useFile(file); };
$('stop').onclick = () => stopSource(opening ? 'Canceled.' : {camera: 'Camera stopped.', phone: 'Phone feed stopped.', file: 'Recording closed.'}[source] || '');
$('selectStaff').onclick = () => select('staff');
$('cancelSelection').onclick = () => cancelSelection();
$('undoPoint').onclick = undoPoint;
$('fullscreen').onclick = toggleFullscreen;
for (const id of ['mirror', 'trails', 'smooth']) $(id).onchange = render;
view.addEventListener('click', event => {
  if (mode !== 'selecting') return;
  const point = canvasPoint(event, view, mirrored());
  if (point) place(point);
});
$('playPause').onclick = playPause;
$('seek').oninput = () => { if (source === 'file' && Number.isFinite(video.duration)) video.currentTime = Number($('seek').value); };
$('playback').onchange = () => { video.playbackRate = Number($('playback').value); };
video.addEventListener('seeking', () => {
  // A jump in time breaks continuity. Ask for a fresh selection instead of guessing.
  if (source !== 'file' || (mode !== 'tracking' && mode !== 'starting')) return;
  endSelection(); endTracking(); mode = 'live';
  message('You moved to another moment. Select the staff again to follow from here.');
  render();
});
video.addEventListener('ended', () => { if (source === 'file') message('End of the recording. Drag the position bar back to replay.'); });
for (const event of ['play', 'pause']) video.addEventListener(event, () => { if (source === 'file') render(); });
for (const event of ['durationchange', 'ratechange']) video.addEventListener(event, renderPlayback);
$('importLens').onclick = () => $('lensFile').click();
$('lensFile').onchange = () => { const file = $('lensFile').files[0]; $('lensFile').value = ''; if (file) guarded(importLens, 'Lens profile not applied')(file); };
$('saveLens').onclick = saveLens;
$('clearLens').onclick = guarded(async () => { await configure({lens: null, corners: null, aspect: geometry.aspect}); message('Lens correction cleared. Select the staff again.'); });
$('selectPlane').onclick = () => select('plane');
$('clearPlane').onclick = guarded(async () => { await configure({...geometry, corners: null}); message('Viewing angle cleared. Select the staff again.'); });
$('planeAspect').onchange = guarded(async () => { const aspect = planeAspect(); if (geometry.corners) await configure({...geometry, aspect}); else geometry.aspect = aspect; });
$('captureBoard').onclick = guarded(captureBoard, 'Board view not captured');
$('solveLens').onclick = guarded(solveLens, 'Lens profile not calculated');
$('clearBoard').onclick = guarded(clearBoard);
addEventListener('keydown', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (target.matches?.('input:not([type=checkbox]):not([type=range]), select, textarea')) return;
  const free = target === document.body || target === view || target === document.documentElement;
  if (mode === 'selecting' && (free || event.key === 'Backspace') && selectionKey(event)) { event.preventDefault(); return; }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === 'r') select('staff');
  else if (key === 'Escape' && (mode === 'selecting' || mode === 'preparing')) cancelSelection();
  else if (key === 'f') toggleFullscreen();
  else if (key === 'm') flip('mirror');
  else if (key === 'p') flip('trails');
  else if (key === 'v') flip('smooth');
  else if (free && (key === ' ' || key === 'k') && source === 'file') playPause();
  else if ((key === ',' || key === '.') && source === 'file') stepFrame(key === '.' ? 1 : -1);
  else return;
  event.preventDefault();
});
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
});
// Marks keep their on-screen size, so redraw still frames when the view resizes.
new ResizeObserver(() => requestAnimationFrame(() => { if (!showsLive()) draw(); })).observe($('stage'));
navigator.mediaDevices?.addEventListener?.('devicechange', () => listCameras());
addEventListener('pagehide', () => stopSource());
listCameras();
render();
pollStatus();
setInterval(pollStatus, 4000);
