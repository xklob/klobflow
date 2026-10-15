import {CAP_EVIDENCE} from './cap-evidence.mjs';

// Require learned cap loss as well as shortening; projected length alone is not occlusion.
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * q;
  const lower = Math.floor(index), fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.min(sorted.length - 1, lower + 1)] * fraction;
}
function angleDifference(a, b) { return Math.abs(Math.atan2(Math.sin(2 * (a - b)), Math.cos(2 * (a - b)))) / 2; }
function precise(s) { return Boolean(s && s.confidence >= .55 && !s.blurred && !s.occluded); }

export class CapOcclusionGuard {
  constructor() { this.reset(); }
  reset() { this.lengthHistory = []; this.capHistory = []; this.latched = false; this.clearFrames = 0; this.updatedAt = null; }
  // One instance per associated staff identity; time is milliseconds.
  update(segment, time, evidence = segment?.[CAP_EVIDENCE]) {
    if (this.updatedAt !== null && time <= this.updatedAt) this.reset();
    this.updatedAt = time;
    this.lengthHistory = this.lengthHistory.filter(row => time - row.time < 4000);
    this.capHistory = this.capHistory.filter(row => time - row.time < 4000);
    if (!segment || !evidence) { this.clearFrames = 0; return segment; }
    const length = Math.hypot(segment.b[0] - segment.a[0], segment.b[1] - segment.a[1]);
    const angle = Math.atan2(segment.b[1] - segment.a[1], segment.b[0] - segment.a[0]);
    const recent = this.lengthHistory.filter(row => time - row.time > 80);
    const local = recent.filter(row => angleDifference(angle, row.angle) < .3);
    const reference = recent.length >= 12 ? quantile((local.length >= 5 ? local : recent).map(row => row.length), .8) : null;
    const referenceWidth = this.capHistory.length >= 8 ? quantile(this.capHistory.map(row => row.width), .5) * evidence.pixelLength : null;
    const referenceRatio = this.capHistory.length >= 8 ? quantile(this.capHistory.map(row => row.ratio), .5) : null;
    const ratio = evidence.minWidth / Math.max(1e-9, evidence.maxWidth);
    const short = reference !== null && length < reference * .90;
    const missing = referenceWidth !== null && referenceRatio !== null && evidence.minWidth < referenceWidth * .70 &&
      ratio < referenceRatio * .50 && evidence.maxWidth > referenceWidth * .85;
    const trigger = precise(segment) && short && missing && evidence.neutralPeak >= 225;
    if (trigger) { this.latched = true; this.clearFrames = 0; }
    else if (this.latched) {
      const clear = precise(segment) && referenceWidth !== null && referenceRatio !== null &&
        evidence.minWidth >= referenceWidth * .80 && ratio >= referenceRatio * .80 && evidence.neutralPeak >= 230;
      this.clearFrames = clear ? this.clearFrames + 1 : 0;
      if (this.clearFrames >= 2 || !this.capHistory.length) { this.latched = false; this.clearFrames = 0; }
    }
    const flag = precise(segment) && this.latched;
    if (precise(segment) && !flag) {
      this.lengthHistory.push({time, length, angle});
      if (evidence.minWidth >= 3 && ratio >= .65 && evidence.neutralPeak >= 230)
        this.capHistory.push({time, width: evidence.minWidth / evidence.pixelLength, ratio});
    }
    return flag ? {...segment, confidence: Math.min(.35, segment.confidence), occluded: true} : segment;
  }
}
