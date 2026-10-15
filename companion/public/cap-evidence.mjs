// Symmetric private detector evidence. Symbol properties survive copies but never enter JSON.
export const CAP_EVIDENCE = Symbol('klobflow.capEvidence');

export function measureCapEvidence(pixels, w, h, segment) {
  const unit = Math.min(w, h), a = segment.a.map(v => v * unit), b = segment.b.map(v => v * unit);
  const pixelLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!Number.isFinite(pixelLength) || pixelLength <= 0) return null;
  const ux = (b[0] - a[0]) / pixelLength, uy = (b[1] - a[1]) / pixelLength;
  const depth = Math.min(12, pixelLength * .1), halfWidth = Math.min(8, pixelLength * .06);
  const endpoints = [];
  for (const [start, dx, dy] of [[a, ux, uy], [b, -ux, -uy]]) {
    const corners = [];
    for (const along of [0, depth]) for (const across of [-halfWidth, halfWidth])
      corners.push([start[0] + dx * along - dy * across, start[1] + dy * along + dx * across]);
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p[0]))));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(...corners.map(p => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p[1]))));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(...corners.map(p => p[1]))));
    let area = 0, peak = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const rx = x - start[0], ry = y - start[1], along = rx * dx + ry * dy, across = -rx * dy + ry * dx;
      if (along < 0 || along >= depth || Math.abs(across) > halfWidth) continue;
      const p = pixels[y * w + x], r = p >>> 16 & 255, g = p >>> 8 & 255, b = p & 255;
      const high = Math.max(r, g, b), low = Math.min(r, g, b), neutral = low + .25 * (high - low);
      peak = Math.max(peak, neutral);
      if (neutral >= 210) area++;
    }
    endpoints.push({width: area / depth, peak});
  }
  // The guard is symmetric, so Segment.copy/reversed need not reorder metadata.
  return {pixelLength, minWidth: Math.min(...endpoints.map(p => p.width)),
    maxWidth: Math.max(...endpoints.map(p => p.width)), neutralPeak: Math.min(...endpoints.map(p => p.peak))};
}

export function attachCapEvidence(pixels, w, h, segment) {
  return {...segment, [CAP_EVIDENCE]: measureCapEvidence(pixels, w, h, segment)};
}
