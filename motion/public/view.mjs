// Drawing and coordinate helpers. Points are normalised to the analysed image in
// camera orientation. The display mirror is applied here and nowhere else.
export const colors = {a: '#6fe3f5', b: '#c4a3ff', mid: '#ffffff', mint: '#7fe8c9'};

// Part of the canvas that shows the image when object-fit: contain letterboxes it.
export function contentBox(canvas) {
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height || !canvas.width || !canvas.height) return null;
  const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
  const width = canvas.width * scale, height = canvas.height * scale;
  return {left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height};
}

export function canvasPoint(event, canvas, mirror) {
  const box = contentBox(canvas);
  if (!box) return null;
  const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [mirror ? 1 - x : x, y];
}

const finite = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const inView = point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function drawFrame(canvas, image, {mirror = false, result = null, history = [], trails = true, selection = null, maxWidth = 0} = {}) {
  const sourceWidth = image.videoWidth || image.width, sourceHeight = image.videoHeight || image.height;
  if (!sourceWidth || !sourceHeight) return false;
  const fit = maxWidth ? Math.min(1, maxWidth / sourceWidth) : 1;
  const width = Math.round(sourceWidth * fit), height = Math.round(sourceHeight * fit);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d');
  ctx.save(); ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? width : 0, 0);
  ctx.drawImage(image, 0, 0, width, height); ctx.restore();
  if (!result && !selection) return true;
  // Marks are sized for the displayed view: larger in full screen, smaller on a phone.
  const box = contentBox(canvas), shown = box ? box.width : 1200;
  const factor = Math.min(1.4, Math.max(.7, shown / 1200)) * width / shown;
  const size = value => value * factor;
  const at = point => [(mirror ? 1 - point.x : point.x) * width, point.y * height];

  function label(text, x, y, color, radius) {
    ctx.font = `700 ${size(20)}px system-ui, sans-serif`;
    const textWidth = ctx.measureText(text).width, pad = size(7), boxHeight = size(29);
    const left = clamp(x + radius + size(6), pad, width - textWidth - pad * 2);
    const top = clamp(y - radius - boxHeight, pad, height - boxHeight - pad);
    ctx.setLineDash([]); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(5, 12, 24, .82)'; ctx.fillRect(left, top, textWidth + pad * 2, boxHeight);
    ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, left + pad, top + boxHeight / 2);
  }
  // Filled ring: an endpoint of the model's visible shape, not calibrated tip accuracy.
  // Dashed ring: an estimate, for example while the end is hidden.
  function ring(point, text, color, radius = 19) {
    if (!finite(point)) return;
    const estimated = point.state !== 'visible', outside = !inView(point), r = size(radius);
    let [x, y] = at(point);
    if (outside) { x = clamp(x, r + size(6), width - r - size(6)); y = clamp(y, r + size(6), height - r - size(6)); }
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .85)'; ctx.shadowBlur = size(6);
    ctx.lineWidth = size(4); ctx.strokeStyle = color; ctx.setLineDash(estimated ? [size(7), size(6)] : []);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (!estimated) { ctx.fillStyle = `${color}44`; ctx.fill(); }
    ctx.stroke();
    if (!estimated) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, size(5), 0, Math.PI * 2); ctx.fill(); }
    label(outside ? `${text} · OUT OF VIEW` : estimated ? `${text} · EST` : text, x, y, color, r);
    ctx.restore();
  }
  function link(from, to, dashed, color = 'rgba(255, 255, 255, .45)') {
    if (!finite(from) || !finite(to)) return;
    ctx.save(); ctx.lineWidth = size(2); ctx.strokeStyle = color; ctx.setLineDash(dashed ? [size(6), size(6)] : []);
    ctx.beginPath(); ctx.moveTo(...at(from)); ctx.lineTo(...at(to)); ctx.stroke(); ctx.restore();
  }
  function path(pick, color, lineWidth, rainbowOffset = null) {
    let previous = null;
    ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.lineWidth = size(lineWidth);
    for (const frame of history) {
      const point = pick(frame), age = result.time - frame.time;
      if (!finite(point) || age < 0 || age > 4) { previous = null; continue; }
      // Skip long gaps instead of drawing a jump the model never followed.
      if (previous && frame.time - previous.time <= 1) {
        ctx.globalAlpha = .85 * (1 - age / 4);
        // One turn of hue per four seconds. Each segment retains its original
        // hue as it fades; end markers retain their stable A/B identity colors.
        ctx.strokeStyle = rainbowOffset === null ? color : `hsl(${(frame.time * 90 + rainbowOffset) % 360} 100% 68%)`;
        ctx.setLineDash(point.state !== 'visible' || previous.point.state !== 'visible' ? [size(7), size(7)] : []);
        ctx.beginPath(); ctx.moveTo(...at(previous.point)); ctx.lineTo(...at(point)); ctx.stroke();
      }
      previous = {point, time: frame.time};
    }
    ctx.restore();
  }

  if (result?.ends?.length === 2) {
    const [a, b] = result.ends;
    if (trails) {
      path(frame => frame.ends?.[0], colors.a, 4, 0);
      path(frame => frame.ends?.[1], colors.b, 4, 180);
      path(frame => frame.midpoint, 'rgba(255, 255, 255, .8)', 2.5);
    }
    link(a, b, a.state !== 'visible' || b.state !== 'visible');
    ring(a, 'A', colors.a); ring(b, 'B', colors.b); ring(result.midpoint, 'MID', colors.mid, 13);
  }
  if (selection) {
    const points = selection.points.map(([x, y]) => ({x, y, state: 'visible'}));
    if (selection.kind === 'plane') {
      for (let i = 1; i < points.length; i++) link(points[i - 1], points[i], true, colors.mint);
      if (points.length === 4) link(points[3], points[0], true, colors.mint);
      points.forEach((point, i) => ring(point, String(i + 1), colors.mint, 14));
    } else {
      if (points.length === 2) link(points[0], points[1], false);
      points.forEach((point, i) => ring(point, 'AB'[i], i ? colors.b : colors.a));
    }
    if (selection.cursor) {
      const [x, y] = at({x: selection.cursor[0], y: selection.cursor[1]}), r = size(22);
      ctx.save(); ctx.shadowColor = 'rgba(0, 0, 0, .9)'; ctx.shadowBlur = size(4);
      ctx.strokeStyle = colors.mint; ctx.lineWidth = size(2.5);
      ctx.beginPath();
      ctx.moveTo(x - r, y); ctx.lineTo(x - r / 3, y); ctx.moveTo(x + r / 3, y); ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r); ctx.lineTo(x, y - r / 3); ctx.moveTo(x, y + r / 3); ctx.lineTo(x, y + r);
      ctx.stroke(); ctx.restore();
    }
  }
  return true;
}

export function encodeFrame(metadata, jpeg) {
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const header = new Uint8Array(8), view = new DataView(header.buffer);
  view.setUint32(0, json.length); view.setUint32(4, jpeg.size);
  return new Blob([header, json, jpeg]);
}

// The Android app mirrors shared frames when its own mirror setting is on. Undo
// that once, so the model, calibration and clicks always see camera orientation.
export async function orientedBitmap(jpeg, mirrored) {
  const bitmap = await createImageBitmap(new Blob([jpeg], {type: 'image/jpeg'}));
  if (!mirrored) return bitmap;
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
  ctx.setTransform(-1, 0, 0, 1, bitmap.width, 0); ctx.drawImage(bitmap, 0, 0); bitmap.close();
  return canvas.transferToImageBitmap();
}

// Corners are clicked clockwise from the top left as seen on screen. A mirrored
// view swaps left and right, so reorder to image order: TL, TR, BR, BL.
export function imageCorners(points, mirror) {
  return mirror ? [points[1], points[0], points[3], points[2]] : points.slice();
}

// Image y points down, so every turn of a convex, clockwise quadrilateral is positive.
export function cornerProblem(points) {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = points[i], [bx, by] = points[(i + 1) % 4], [cx, cy] = points[(i + 2) % 4];
    area += ax * by - bx * ay;
    if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) <= 0) return 'Click the four corners clockwise from the top left, as you see them on screen.';
  }
  return area / 2 < .005 ? 'Those corners are too close together. Choose a larger reference.' : null;
}

export function formatClock(seconds) {
  if (!Number.isFinite(seconds)) return '--:--';
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
