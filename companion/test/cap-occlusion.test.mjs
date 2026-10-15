import test from 'node:test';
import assert from 'node:assert/strict';
import {CAP_EVIDENCE, attachCapEvidence, measureCapEvidence} from '../public/cap-evidence.mjs';
import {CapOcclusionGuard} from '../public/cap-occlusion.mjs';
import {StaffTracker, Scorer, Guide, defaults} from '../public/core.mjs';
import {FlowStreak} from '../public/streak.mjs';

const segment = (length = 1, angle = 0) => ({a: [0, 0], b: [length * Math.cos(angle), length * Math.sin(angle)], confidence: .8});
const evidence = (length = 1, minWidth = 8, maxWidth = 8, neutralPeak = 255) => ({pixelLength: 216 * length, minWidth, maxWidth, neutralPeak});
function trained() {
  const guard = new CapOcclusionGuard();
  for (let i = 0; i < 30; i++) guard.update(segment(), i * 17, evidence());
  return guard;
}

test('learned paired caps plus shortened one-sided loss abstains without moving current endpoints', () => {
  const guard = trained(), s = segment(.7), actual = guard.update(s, 600, evidence(.7, 1, 8));
  assert.equal(actual.occluded, true); assert.equal(actual.confidence, .35);
  assert.equal(actual.a, s.a); assert.equal(actual.b, s.b);
  assert.equal(s.occluded, undefined); assert.equal(s.confidence, .8);
  const learned = guard.capHistory.length;
  for (let i = 1; i < 60; i++) {
    assert.equal(guard.update(segment(.7), 600 + i * 17, evidence(.7, 1, 8)).occluded, true);
  }
  assert.equal(guard.capHistory.length, learned);
});

test('foreshortening with two visible caps and cap loss without shortening are preserved', () => {
  const guard = trained();
  assert.equal(guard.update(segment(.6), 600, evidence(.6, 5, 6)).occluded, undefined);
  assert.equal(guard.update(segment(), 617, evidence(1, 1, 8)).occluded, undefined);
});

test('two restored precise cap pairs clear latch promptly', () => {
  const guard = trained();
  guard.update(segment(.7), 600, evidence(.7, 1, 8));
  assert.equal(guard.update(segment(.7), 617, evidence(.7, 6, 6)).occluded, true);
  assert.equal(guard.update(segment(.7), 634, evidence(.7, 6, 6)).occluded, undefined);
});

test('unlearned uniform props and a neutral-core loss caused by hue alone do not trigger', () => {
  const guard = new CapOcclusionGuard();
  for (let i = 0; i < 30; i++) guard.update(segment(), i * 17, evidence(1, 2, 2));
  assert.equal(guard.update(segment(.7), 600, evidence(.7, 1, 8)).occluded, undefined);
  const learned = trained();
  assert.equal(learned.update(segment(.7), 600, evidence(.7, 0, 8, 200)).occluded, undefined);
});

test('uncertain observations cannot establish a reference; resets and rewound clocks clear it', () => {
  const guard = new CapOcclusionGuard();
  for (let i = 0; i < 30; i++) guard.update({...segment(), blurred: true}, i * 17, evidence());
  assert.equal(guard.lengthHistory.length, 0); assert.equal(guard.capHistory.length, 0);
  const learned = trained(); assert.equal(learned.update(segment(.7), 100, evidence(.7, 1, 8)).occluded, undefined);
  learned.reset(); assert.equal(learned.latched, false); assert.equal(learned.capHistory.length, 0);
});

test('stale learned appearance expires rather than becoming a permanent veto', () => {
  const guard = trained(); guard.update(segment(.7), 600, evidence(.7, 1, 8));
  assert.equal(guard.update(segment(.7), 5000, evidence(.7, 1, 8)).occluded, undefined);
  assert.equal(guard.capHistory.length, 0);
});

test('missing samples break consecutive restored-cap confirmation', () => {
  for (const absent of [null, segment(.7)]) {
    const guard = trained(); guard.update(segment(.7), 600, evidence(.7, 1, 8));
    assert.equal(guard.update(segment(.7), 617, evidence(.7, 6, 6)).occluded, true);
    guard.update(absent, 634);
    assert.equal(guard.update(segment(.7), 651, evidence(.7, 6, 6)).occluded, true);
    assert.equal(guard.update(segment(.7), 668, evidence(.7, 6, 6)).occluded, undefined);
  }
});

test('raw cap evidence is symmetric, uses brightness-neutral pixels, and survives copies without exporting', () => {
  const w = 100, h = 60, pixels = new Int32Array(w * h), s = {a: [20 / h, 30 / h], b: [80 / h, 30 / h], confidence: .8};
  for (const cx of [20, 80]) for (let y = 27; y <= 33; y++) for (let x = cx - 3; x <= cx + 3; x++) pixels[y * w + x] = 0xffffffff;
  const measured = measureCapEvidence(pixels, w, h, s), reversed = measureCapEvidence(pixels, w, h, {...s, a: s.b, b: s.a});
  assert.deepEqual(measured, reversed); assert.equal(measured.neutralPeak, 255);
  const annotated = attachCapEvidence(pixels, w, h, s), copy = {...annotated, a: s.b, b: s.a};
  assert.equal(copy[CAP_EVIDENCE], annotated[CAP_EVIDENCE]);
  assert.equal(JSON.stringify(annotated), JSON.stringify(s));
});

const annotated = (length = 1, minWidth = 8, maxWidth = 8, peak = 255) =>
  ({...segment(length), [CAP_EVIDENCE]: evidence(length, minWidth, maxWidth, peak)});
function trainedTracker() {
  const tracker = new StaffTracker();
  for (let i = 0; i < 30; i++) tracker.update([annotated()], 1000 + i * 17, 1);
  return tracker;
}
test('gradual body truncation is uncertain even while the association prior learns shorter geometry', () => {
  const tracker = trainedTracker(); let time = 1510;
  for (const length of [.96, .92, .88, .84, .80]) {
    const current = annotated(length, 1, 8), actual = tracker.update([current], time, 1)[0];
    assert.deepEqual(actual.a, current.a); assert.deepEqual(actual.b, current.b);
    if (length < .90) { assert.equal(actual.occluded, true); assert.equal(actual.confidence, .35); }
    assert.deepEqual(tracker.hints(time, 1)[0].b, current.b);
    time += 17;
  }
});
test('source reset, seed, expired identity, and staff-count changes cannot reuse learned cap loss', () => {
  for (const reset of ['reset', 'seed', 'expired', 'count']) {
    const tracker = trainedTracker();
    assert.equal(tracker.update([annotated(.8, 1, 8)], 1510, 1)[0].occluded, true);
    let time = 1527, count = 1;
    if (reset === 'reset') tracker.reset();
    if (reset === 'seed') tracker.seed([annotated(.8, 1, 8)], 1511);
    if (reset === 'expired') time = 4000;
    if (reset === 'count') count = 2;
    let actual;
    for (let i = 0; i < 3; i++) actual = tracker.update([annotated(.8, 1, 8)], time + i * 17, count)[0];
    assert.equal(actual.occluded, false, reset); assert.ok(actual.confidence >= .55, reset);
  }
});
test('cap-loss uncertainty blocks metrics and freezes earned streak time through recovery', () => {
  const tracker = new StaffTracker(), streak = new FlowStreak(), scorer = new Scorer();
  const config = {...defaults, staffCount: 1, tolerance: 50}, guide = new Guide(config, 216, 216);
  let flow;
  function update(time, current) {
    const staffs = tracker.update([current], time, 1), feedback = guide.cues(staffs);
    flow = streak.update({time, config, staffs, feedback});
    return scorer.score(time, staffs, guide);
  }
  for (let i = 0; i < 30; i++) update(1000 + i * 17, annotated());
  const earned = flow.seconds; assert.ok(earned > 0);
  assert.equal(update(1510, annotated(.8, 1, 8)).deviation, null);
  assert.equal(flow.state, 'held'); assert.equal(flow.seconds, earned);
  for (let i = 1; i <= 10; i++) update(1510 + i * 17, annotated(.8, 1, 8));
  assert.equal(flow.seconds, earned);
  assert.equal(update(1697, annotated(.8, 7, 7)).deviation, null);
  assert.notEqual(update(1714, annotated(.8, 7, 7)).deviation, null);
  assert.equal(flow.seconds, earned);
  update(1731, annotated(.8, 7, 7)); assert.ok(flow.seconds > earned);
});
