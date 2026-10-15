// Synthetic media for browser tests. Nothing here opens a real camera, phone,
// recording or model: every frame is drawn on a canvas and labelled SYNTHETIC.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';

// Normalised barcode cells along the bottom left of each frame. The frame counter
// lets a test prove exactly which frame a canvas is showing.
export const BARCODE = {bits: 14, x: .03, y: .9, step: .022, width: .016, height: .05};

// Draws one synthetic staff frame and returns its two end positions. It runs in
// the page, so it must stay self-contained.
export function paintSyntheticFrame(ctx, width, height, n, {label = 'SYNTHETIC TEST CAMERA', barcode = null, swing = true} = {}) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#0b1c33'); sky.addColorStop(1, '#173554');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, width, height);
  // Asymmetric scenery reveals mirroring: a warm block on the image's left only.
  ctx.fillStyle = '#b8462e'; ctx.fillRect(width * .04, height * .08, width * .12, height * .2);
  const angle = swing ? Math.sin(n / 45) * .35 : .3, cx = width * .5, cy = height * .52, half = height * .3;
  const ends = [[cx - Math.sin(angle) * half, cy - Math.cos(angle) * half], [cx + Math.sin(angle) * half, cy + Math.cos(angle) * half]];
  ctx.lineCap = 'round'; ctx.strokeStyle = '#3d4654'; ctx.lineWidth = height * .018;
  ctx.beginPath(); ctx.moveTo(...ends[0]); ctx.lineTo(...ends[1]); ctx.stroke();
  for (const [x, y] of ends) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, height * .06);
    glow.addColorStop(0, '#fffbe8'); glow.addColorStop(.35, '#ffd36acc'); glow.addColorStop(1, '#ffd36a00');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, height * .06, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#ffffffcc'; ctx.font = `600 ${Math.round(height * .035)}px sans-serif`; ctx.textBaseline = 'top';
  ctx.fillText(label, width * .6, height * .05);
  if (barcode) for (let bit = 0; bit < barcode.bits; bit++) {
    ctx.fillStyle = (n >> bit) & 1 ? '#ffffff' : '#000000';
    ctx.fillRect((barcode.x + bit * barcode.step) * width, barcode.y * height, barcode.width * width, barcode.height * height);
  }
  return ends.map(([x, y]) => [x / width, y / height]);
}

// The page CSP forbids eval, so page code is shipped as script text with the painter.
const withPainter = (fn, args) => `(${fn})(${JSON.stringify(args)}, ${paintSyntheticFrame})`;

// Replace getUserMedia with an animated canvas stream. No camera hardware opens.
export async function installSyntheticCamera(page, {width = 1280, height = 720, delayMs = 0, label = 'SYNTHETIC TEST CAMERA', swing = true} = {}) {
  await page.addInitScript(withPainter(({width, height, delayMs, label, swing, barcode}, paint) => {
    const camera = window.syntheticCamera = {opened: 0, stopped: 0, frame: 0, requests: []};
    navigator.mediaDevices.getUserMedia = async constraints => {
      camera.requests.push(constraints);
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      const next = () => { camera.frame++; paint(ctx, width, height, camera.frame, {label, barcode, swing}); };
      next();
      const timer = setInterval(next, 1000 / 30), stream = canvas.captureStream(30);
      camera.opened++;
      for (const track of stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => { clearInterval(timer); camera.stopped++; stop(); };
      }
      return stream;
    };
    navigator.mediaDevices.enumerateDevices = async () => [{kind: 'videoinput', deviceId: 'synthetic-camera', groupId: 'synthetic', label, toJSON() { return this; }}];
  }, {width, height, delayMs, label, swing, barcode: BARCODE}));
}

// Reads the frame counter painted by paintSyntheticFrame from a canvas.
export function readBarcode(page, selector, {mirror = false} = {}) {
  return page.evaluate(({selector, mirror, barcode}) => {
    const canvas = document.querySelector(selector), {width, height} = canvas;
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    let value = 0;
    for (let bit = 0; bit < barcode.bits; bit++) {
      let x = Math.round((barcode.x + bit * barcode.step + barcode.width / 2) * width);
      if (mirror) x = width - 1 - x;
      const y = Math.round((barcode.y + barcode.height / 2) * height), i = (y * width + x) * 4;
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 384) value |= 1 << bit;
    }
    return value;
  }, {selector, mirror, barcode: BARCODE});
}

// Decodes JPEG bytes in the page and reads the same barcode from them.
export function jpegBarcode(page, jpeg) {
  return page.evaluate(async ({bytes, barcode}) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], {type: 'image/jpeg'}));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let value = 0;
    for (let bit = 0; bit < barcode.bits; bit++) {
      const x = Math.round((barcode.x + bit * barcode.step + barcode.width / 2) * bitmap.width);
      const y = Math.round((barcode.y + barcode.height / 2) * bitmap.height), i = (y * bitmap.width + x) * 4;
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 384) value |= 1 << bit;
    }
    return {value, width: bitmap.width, height: bitmap.height};
  }, {bytes: [...jpeg], barcode: BARCODE});
}

// A synthetic JPEG, optionally mirrored the way the Android app mirrors shared frames.
export async function syntheticJpeg(page, {width = 640, height = 480, n = 1, mirror = false, label = 'SYNTHETIC PHONE'} = {}) {
  const base64 = await page.evaluate(withPainter(({width, height, n, mirror, label, barcode}, paint) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (mirror) { ctx.translate(width, 0); ctx.scale(-1, 1); }
    paint(ctx, width, height, n, {label, barcode, swing: false});
    return canvas.toDataURL('image/jpeg', .92).split(',')[1];
  }, {width, height, n, mirror, label, barcode: BARCODE}));
  return Buffer.from(base64, 'base64');
}

// Encodes a small WebM recording from synthetic frames with the system ffmpeg.
export async function syntheticRecording(page, path, {frames = 120, width = 640, height = 360} = {}) {
  const base64 = await page.evaluate(withPainter(({frames, width, height, barcode}, paint) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', {willReadFrequently: true}), out = new Uint8Array(frames * width * height * 3);
    for (let n = 0; n < frames; n++) {
      paint(ctx, width, height, n + 1, {label: 'SYNTHETIC TEST RECORDING', barcode});
      const rgba = ctx.getImageData(0, 0, width, height).data;
      for (let i = 0, j = n * width * height * 3; i < rgba.length; i += 4, j += 3) { out[j] = rgba[i]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i + 2]; }
    }
    let text = '';
    for (let i = 0; i < out.length; i += 32768) text += String.fromCharCode(...out.subarray(i, i + 32768));
    return btoa(text);
  }, {frames, width, height, barcode: BARCODE}));
  writeFileSync(`${path}.rgb`, Buffer.from(base64, 'base64'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${width}x${height}`, '-r', '30',
    '-i', `${path}.rgb`, '-c:v', 'libvpx', '-b:v', '3M', '-g', '10', '-pix_fmt', 'yuv420p', path]);
  return path;
}

// Packs one stable-protocol phone packet: two big-endian lengths, JSON, JPEG.
export function phonePacket(frame, jpeg) {
  const json = Buffer.from(JSON.stringify(frame)), head = Buffer.alloc(8);
  head.writeUInt32BE(json.length); head.writeUInt32BE(jpeg.length, 4);
  return Buffer.concat([head, json, jpeg]);
}
