// Interaction tests for the motion lab UI. Every frame is synthetic and every
// model reply comes from the fixture server's fake tracker, which echoes the
// selected points back. These tests prove UI wiring, never tracking accuracy.
import {test, expect} from '@playwright/test';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {installSyntheticCamera, readBarcode, jpegBarcode, syntheticJpeg, syntheticRecording, phonePacket} from './synthetic.mjs';
import {proxyModel, serverIdle, clickView, pixel, near, hex, startSyntheticCamera, selectEnds, obscuredControls, ringCoverage} from './helpers.mjs';

const shots = fileURLToPath(new URL('../../review/rewrite/ui-shots/', import.meta.url));
const cyan = hex('#6fe3f5'), violet = hex('#c4a3ff'), warm = hex('#b8462e');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const tracked = model => model.frames().filter(entry => !entry.frame.previewOnly && !entry.frame.seed);

test.beforeEach(async ({page, request}) => {
  await serverIdle(request);
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
});
test.afterEach(async ({page}) => { expect(page.errors).toEqual([]); });

test('before any source the UI is readable, honest and reachable by keyboard', async ({page}) => {
  for (const [width, height] of [[1920, 1080], [1280, 800], [820, 1180], [390, 844]]) {
    await page.setViewportSize({width, height});
    await page.goto('/');
    await expect(page.locator('#modelText')).toHaveText('Test fixture · local CPU');
    await expect(page.locator('#trackingState')).toHaveText('No source yet');
    for (const id of ['camera', 'cameraChoice', 'usb', 'lan', 'openFile', 'fullscreen']) await expect(page.locator(`#${id}`)).toBeEnabled();
    for (const id of ['stop', 'selectStaff']) await expect(page.locator(`#${id}`)).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeGreaterThanOrEqual(18);
    expect(await obscuredControls(page)).toEqual([]);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({path: `${shots}empty-${width}.png`});
  }
  // Descriptive only: no percentages, scores-as-judgements, targets or alignment advice.
  expect(await page.locator('body').innerText()).not.toMatch(/\d\s?%|accuracy|on target|aligned|perfect/i);
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/');
  const reached = [];
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); reached.push(await page.evaluate(() => document.activeElement.id)); }
  expect(reached).toEqual(expect.arrayContaining(['camera', 'cameraChoice', 'usb', 'lan', 'openFile', 'fullscreen', 'mirror', 'trails', 'smooth']));
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#openFile').press('Enter');
  expect((await chooser).isMultiple()).toBe(false);
});

test('synthetic PC camera: live view, still-frame selection when mirrored, exact-frame results', async ({page}) => {
  await installSyntheticCamera(page);
  const model = await proxyModel(page);
  await page.goto('/');
  await startSyntheticCamera(page);
  // The existing camera primitive opened it, starting from 1280 x 720 at up to 60 fps.
  expect(await page.evaluate(() => window.syntheticCamera.requests[0].video)).toMatchObject({width: {ideal: 1280}, frameRate: {ideal: 60}});
  // The live view runs without any model traffic.
  const first = await readBarcode(page, '#view', {mirror: true});
  await expect.poll(() => readBarcode(page, '#view', {mirror: true})).toBeGreaterThan(first);
  expect(model.sent).toEqual([]);
  await expect(page.locator('#viewLabel')).toHaveText('PC camera · live');
  // Mirrored by default: the warm block on the image's left is drawn on the right.
  expect(near(await pixel(page, .9, .15), warm)).toBe(true);

  // R freezes a still frame. The still holds while the small LIVE view moves on.
  await page.keyboard.press('r');
  await expect(page.locator('#viewLabel')).toHaveText('Still frame');
  await expect(page.locator('#instructionTitle')).toHaveText('Click end A');
  const still = await readBarcode(page, '#view', {mirror: true});
  await expect.poll(() => readBarcode(page, '#live', {mirror: true})).toBeGreaterThan(still + 3);
  expect(await readBarcode(page, '#view', {mirror: true})).toBe(still);
  const preview = model.frames().at(-1);
  expect(preview.frame).toMatchObject({previewOnly: true, seed: null, calibrationCapture: false});
  expect((await jpegBarcode(page, preview.jpeg)).value).toBe(still);

  // Clicks are on screen. With the view mirrored, image x is 1 - screen x.
  await clickView(page, .3, .4);
  await expect(page.locator('#instructionTitle')).toHaveText('Click end B');
  await clickView(page, .7, .6);
  await expect(page.locator('#trackingState')).toHaveText('Following staff shape');
  const seeded = model.frames().find(entry => entry.frame.seed);
  expect(seeded.frame.previewOnly).toBe(false);
  expect(seeded.frame.seed[0][0]).toBeCloseTo(.7, 2); expect(seeded.frame.seed[0][1]).toBeCloseTo(.4, 2);
  expect(seeded.frame.seed[1][0]).toBeCloseTo(.3, 2); expect(seeded.frame.seed[1][1]).toBeCloseTo(.6, 2);
  // The seed travels with the very frame that was clicked on.
  expect((await jpegBarcode(page, seeded.jpeg)).value).toBe(still);
  expect(seeded.frame.time).toBe(preview.frame.time);

  await expect.poll(() => tracked(model).length).toBeGreaterThan(5);
  await expect(page.locator('#viewLabel')).toHaveText('Analysed frames');
  await expect(page.locator('#selectText')).toHaveText('Reselect staff ends');
  await expect(page.locator('#latency')).toHaveText(/^Analysed \d+(\.\d)? fps · \d+ ms behind live$/);
  for (const id of ['aState', 'midState', 'bState']) await expect(page.locator(`#${id}`)).toHaveText('Image estimate');
  await expect(page.locator('#aRow')).toHaveAttribute('data-state', 'visible');

  // Stall the model. One frame stays in flight, the LIVE view keeps moving, and
  // the main view shows exactly the newest reply that actually arrived.
  model.hold = true;
  await expect.poll(() => model.held.length).toBe(1);
  const sentWhileStalled = model.frames().length, livePreview = await readBarcode(page, '#live', {mirror: true});
  await expect.poll(() => readBarcode(page, '#live', {mirror: true})).toBeGreaterThan(livePreview + 3);
  expect(model.frames().length).toBe(sentWhileStalled);
  const shown = await readBarcode(page, '#view', {mirror: true}), lastReply = model.delivered().filter(reply => reply.packet).at(-1);
  expect(shown).toBe((await jpegBarcode(page, lastReply.jpeg)).value);
  expect(shown).not.toBe((await jpegBarcode(page, model.held[0].jpeg)).value);
  // Filled rings sit where they were clicked on screen: cyan A, violet B.
  expect(near(await pixel(page, .3, .4), cyan)).toBe(true);
  expect(near(await pixel(page, .7, .6), violet)).toBe(true);
  await page.screenshot({path: `${shots}camera-tracking.png`});
  // Unmirrored, the same analysed frame flips and so do its rings.
  await page.keyboard.press('m');
  await expect(page.locator('#mirror')).not.toBeChecked();
  expect(await readBarcode(page, '#view')).toBe(shown);
  expect(near(await pixel(page, .7, .4), cyan)).toBe(true);
  expect(near(await pixel(page, .3, .6), violet)).toBe(true);
  model.release();
  await expect.poll(() => tracked(model).length).toBeGreaterThan(sentWhileStalled);
});

test('reselect is one action mid-tracking, works from the keyboard, and stale replies never paint', async ({page}) => {
  await installSyntheticCamera(page);
  const model = await proxyModel(page);
  await page.goto('/');
  await startSyntheticCamera(page);
  await selectEnds(page, [.3, .4], [.7, .6]);
  // Reselect while a tracking reply is still in flight: no "wait" error.
  model.hold = true;
  await expect.poll(() => model.held.length).toBe(1);
  await page.locator('#selectStaff').click();
  await expect(page.locator('#viewLabel')).toHaveText('Freezing a frame…');
  model.release();
  await expect(page.locator('#viewLabel')).toHaveText('Still frame');
  const preview = model.frames().filter(entry => entry.frame.previewOnly).at(-1);
  expect(await readBarcode(page, '#view', {mirror: true})).toBe((await jpegBarcode(page, preview.jpeg)).value);
  await expect(page.locator('#aState')).toHaveText('Waiting');
  // Escape cancels and returns to the live view with nothing stale left behind.
  await page.keyboard.press('Escape');
  await expect(page.locator('#message')).toHaveText('Selection canceled.');
  await expect(page.locator('#viewLabel')).toHaveText('PC camera · live');
  await expect(page.locator('#trackingState')).toHaveText('Ready to select');
  // Keyboard only: arrows move a cursor on screen, Enter places, Backspace undoes.
  await page.keyboard.press('r');
  await expect(page.locator('#viewLabel')).toHaveText('Still frame');
  await expect(page.locator('#view')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.locator('#instructionTitle')).toHaveText('Click end B');
  await page.keyboard.press('Backspace');
  await expect(page.locator('#instructionTitle')).toHaveText('Click end A');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(page.locator('#trackingState')).toHaveText('Following staff shape');
  const seed = model.frames().filter(entry => entry.frame.seed).at(-1).frame.seed;
  expect(seed[0][0]).toBeCloseTo(.5, 3); expect(seed[0][1]).toBeCloseTo(.44, 3);
  expect(seed[1][0]).toBeCloseTo(.65, 3); expect(seed[1][1]).toBeCloseTo(.44, 3);
  // Stop with a reply in flight: the empty state returns and the camera is released.
  model.hold = true;
  await expect.poll(() => model.held.length).toBe(1);
  await page.locator('#stop').click();
  await expect(page.locator('#message')).toHaveText('Camera stopped.');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#trackingState')).toHaveText('No source yet');
  for (const id of ['aState', 'midState', 'bState']) await expect(page.locator(`#${id}`)).toHaveText('Waiting');
  expect(await pixel(page, .3, .4)).toEqual([0, 0, 0]);
  expect(await page.evaluate(() => window.syntheticCamera.stopped)).toBe(await page.evaluate(() => window.syntheticCamera.opened));
});

test('canceling a slow camera or a silent phone leaves nothing behind', async ({page}) => {
  await installSyntheticCamera(page, {delayMs: 1500});
  await page.goto('/');
  await page.locator('#camera').click();
  await expect(page.locator('#trackingState')).toHaveText('Connecting…');
  await page.locator('#stop').click();
  await expect(page.locator('#message')).toHaveText('Canceled.');
  // The camera opens late. It is stopped at once and never shown.
  await expect.poll(() => page.evaluate(() => window.syntheticCamera.stopped)).toBe(1);
  expect(await page.evaluate(() => window.syntheticCamera.opened)).toBe(1);
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#stop')).toBeDisabled();
  const silent = http.createServer(() => {});
  await listen(silent);
  try {
    await page.locator('#lan').click();
    await expect(page.locator('#lan')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('#address').fill(`127.0.0.1:${silent.address().port}`);
    await page.locator('#address').press('Enter');
    await expect(page.locator('#message')).toHaveText('Connecting to the phone over Wi-Fi…');
    await page.locator('#stop').click();
    await expect(page.locator('#message')).toHaveText('Canceled.');
    await page.waitForTimeout(800);
    await expect(page.locator('#message')).toHaveText('Canceled.');
    await expect(page.locator('#empty')).toBeVisible();
  } finally { silent.closeAllConnections(); silent.close(); }
});

test('phone frames that arrive already mirrored are normalised exactly once', async ({page}) => {
  await page.goto('/');
  const mirroredJpeg = await syntheticJpeg(page, {n: 77, mirror: true}), plainJpeg = await syntheticJpeg(page, {n: 77});
  let config = {mirror: true, facing: 'back', zoom: 0}, jpeg = mirroredJpeg;
  let hardware = {}, online = true;
  const connections = new Set();
  // A synthetic phone speaking the stable stream protocol, reached through /api/phone-stream.
  const phone = http.createServer((request, response) => {
    if (request.url !== '/api/stream') { response.writeHead(404); response.end(); return; }
    if (!online) { response.writeHead(503); response.end('Camera paused'); return; }
    response.writeHead(200, {'Content-Type': 'application/x-klobflow-stream'});
    connections.add(response);
    const timer = setInterval(() => response.write(phonePacket({time: Date.now(), width: 640, height: 480, protocol: 2, currentConfig: config, ...hardware}, jpeg)), 33);
    response.on('close', () => { clearInterval(timer); connections.delete(response); });
  });
  await listen(phone);
  const model = await proxyModel(page);
  try {
    await page.locator('#lan').click();
    await page.locator('#address').fill(`127.0.0.1:${phone.address().port}`);
    await page.locator('#phoneForm button[type=submit]').click();
    await expect(page.locator('#message')).toHaveText('Phone connected. Hold the staff still, then select its two ends.', {timeout: 30000});
    await expect(page.locator('#viewLabel')).toHaveText('Phone · live');
    await expect(page.locator('#phoneForm')).toBeHidden();
    // Page mirror on: the view matches the mirrored picture the phone sent.
    expect(near(await pixel(page, .9, .15), warm)).toBe(true);
    expect(await readBarcode(page, '#view', {mirror: true})).toBe(77);
    // Page mirror off: true camera orientation.
    await page.locator('#mirror').uncheck();
    expect(near(await pixel(page, .1, .15), warm)).toBe(true);
    expect(await readBarcode(page, '#view')).toBe(77);
    // The model receives camera orientation, and mirrored clicks map into it.
    await page.locator('#mirror').check();
    await selectEnds(page, [.25, .3], [.6, .7]);
    const seeded = model.frames().find(entry => entry.frame.seed);
    expect((await jpegBarcode(page, seeded.jpeg)).value).toBe(77);
    expect(seeded.frame.seed[0][0]).toBeCloseTo(.75, 2); expect(seeded.frame.seed[1][0]).toBeCloseTo(.4, 2);
    // The phone switches its own mirror off: same camera image, so tracking continues.
    config = {...config, mirror: false}; jpeg = plainJpeg;
    const before = model.frames().length;
    await expect.poll(() => model.frames().length).toBeGreaterThan(before + 5);
    await expect(page.locator('#trackingState')).toHaveText('Following staff shape');
    expect((await jpegBarcode(page, model.frames().at(-1).jpeg)).value).toBe(77);
    expect(near(await pixel(page, .9, .15), warm)).toBe(true);
    // A zoom change is a new camera mode: the selection is cleared.
    config = {...config, zoom: .5};
    await expect(page.locator('#message')).toHaveText('The phone camera, zoom or frame size changed. Geometry was cleared. Select the staff again.');
    await expect(page.locator('#trackingState')).toHaveText('Ready to select');
    await expect(page.locator('#aState')).toHaveText('Waiting');
    // Fresh native metadata reports actual hardware zoom separately from config.
    await selectEnds(page, [.25, .3], [.6, .7]);
    hardware = {zoom: {ratio: 1.2}, camera: {physicalId: 'wide', focalLengthMm: 6.9, distortionCorrectionMode: 1}};
    await expect(page.locator('#trackingState')).toHaveText('Ready to select');
    // Closing the app ends the stream; reopening it resumes without another click.
    online = false;
    for (const response of connections) response.end();
    await expect(page.locator('#message')).toContainText('reconnect automatically');
    await expect(page.locator('#stop')).toBeEnabled();
    online = true;
    await expect(page.locator('#message')).toContainText('Phone connected', {timeout: 15000});
    expect(await readBarcode(page, '#view', {mirror: true})).toBe(77);
    await page.locator('#stop').click();
    await expect(page.locator('#message')).toHaveText('Phone feed stopped.');
  } finally { phone.closeAllConnections(); phone.close(); }
});

test('local recording: playback controls, paused still-frame selection, seeking asks to reselect', async ({page}, testInfo) => {
  await page.goto('/');
  const file = await syntheticRecording(page, testInfo.outputPath('synthetic-recording.webm'));
  const model = await proxyModel(page);
  await page.locator('#file').setInputFiles(file);
  await expect(page.locator('#playbackBar')).toBeVisible();
  await expect(page.locator('#viewLabel')).toHaveText('Recording · paused');
  await expect(page.locator('#clock')).toHaveText('0:00 / 0:04');
  await expect.poll(() => readBarcode(page, '#view', {mirror: true})).toBe(1);
  // Space plays and pauses; "." steps one frame while paused.
  await page.keyboard.press(' ');
  await expect(page.locator('#playPause')).toHaveText('Pause');
  await expect.poll(() => readBarcode(page, '#view', {mirror: true})).toBeGreaterThan(10);
  await page.keyboard.press(' ');
  await expect(page.locator('#playPause')).toHaveText('Play');
  await page.waitForTimeout(200);
  const paused = await readBarcode(page, '#view', {mirror: true});
  await page.keyboard.press('.');
  await expect.poll(() => readBarcode(page, '#view', {mirror: true})).toBe(paused + 1);
  expect(model.sent).toEqual([]);
  // Selection uses the paused frame, and playback is locked while it is chosen.
  await page.locator('#selectStaff').click();
  await expect(page.locator('#viewLabel')).toHaveText('Still frame');
  await expect(page.locator('#playPause')).toBeDisabled();
  await expect(page.locator('#seek')).toBeDisabled();
  await clickView(page, .4, .3);
  await clickView(page, .6, .75);
  await expect(page.locator('#trackingState')).toHaveText('Following staff shape');
  expect((await jpegBarcode(page, model.frames().find(entry => entry.frame.seed).jpeg)).value).toBe(paused + 1);
  // Following resumes playback from that frame.
  await expect(page.locator('#playPause')).toHaveText('Pause');
  await expect.poll(() => tracked(model).length).toBeGreaterThan(3);
  // A jump in time breaks continuity, so tracking stops and asks for a new selection.
  await page.locator('#seek').evaluate(range => { range.value = '0.5'; range.dispatchEvent(new Event('input', {bubbles: true})); });
  await expect(page.locator('#message')).toHaveText('You moved to another moment. Select the staff again to follow from here.');
  await expect(page.locator('#trackingState')).toHaveText('Ready to select');
  await page.locator('#stop').click();
  await expect(page.locator('#playbackBar')).toBeHidden();
  await expect(page.locator('#message')).toHaveText('Recording closed.');
});

test('reference corners clicked on a mirrored view reach the server in image order', async ({page}) => {
  await installSyntheticCamera(page);
  const model = await proxyModel(page);
  await page.goto('/');
  await startSyntheticCamera(page);
  await page.locator('#geometry > summary').click();
  await page.locator('#selectPlane').click();
  await expect(page.locator('#instructionTitle')).toHaveText('Click corner 1 of 4 · Top left');
  // A counter-clockwise order is caught before anything is sent.
  for (const point of [[.25, .2], [.2, .75], [.8, .8], [.75, .25]]) await clickView(page, ...point);
  await expect(page.locator('#instructionDetail')).toHaveText('Click the four corners clockwise from the top left, as you see them on screen.');
  expect(model.commands('geometry')).toEqual([]);
  // Clockwise as seen on a mirrored screen. The server must get image TL, TR, BR, BL.
  for (const point of [[.25, .2], [.75, .25], [.8, .8], [.2, .75]]) await clickView(page, ...point);
  await expect(page.locator('#planeStatus')).toHaveText('Viewing angle corrected from your reference corners.');
  const corners = model.commands('geometry').at(-1).command.corners;
  [[.25, .25], [.75, .2], [.8, .75], [.2, .8]].forEach(([x, y], i) => { expect(corners[i][0]).toBeCloseTo(x, 2); expect(corners[i][1]).toBeCloseTo(y, 2); });
  // The main view now shows server-corrected frames, as the model will see them.
  await expect(page.locator('#viewLabel')).toHaveText('Corrected view');
  await expect.poll(() => model.frames().filter(entry => entry.frame.previewOnly).length).toBeGreaterThan(4);
  await page.locator('#clearPlane').click();
  await expect(page.locator('#planeStatus')).toHaveText('Original viewing angle');
  expect(model.commands('geometry').at(-1).command.corners).toBeNull();
  // A broken lens profile is refused by the server and nothing changes.
  await page.locator('#lensFile').setInputFiles({name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"width": 10}')});
  await expect(page.locator('#message')).toContainText('Lens profile not applied');
  await expect(page.locator('#lensStatus')).toHaveText('No lens correction');
  // A valid (identity) profile applies; board views are counted and cleared.
  const identity = {width: 960, height: 540, matrix: [[800, 0, 480], [0, 800, 270], [0, 0, 1]], distortion: [0, 0, 0, 0, 0], model: 'pinhole'};
  await page.locator('#lensFile').setInputFiles({name: 'identity.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(identity))});
  await expect(page.locator('#lensStatus')).toHaveText('Imported profile applied. Check that straight lines look straight.');
  await expect(page.locator('#saveLens')).toBeEnabled();
  await page.locator('#geometry details > summary').click();
  await page.locator('#captureBoard').click();
  await expect(page.locator('#boardCount')).toHaveText('1 view captured · 7 more needed');
  expect(model.frames().filter(entry => entry.frame.calibrationCapture)).toHaveLength(1);
  await expect(page.locator('#solveLens')).toBeDisabled();
  await page.locator('#clearBoard').click();
  await expect(page.locator('#boardCount')).toHaveText('0 views captured');
  // A new source clears geometry and selection.
  await page.locator('#camera').click();
  await expect(page.locator('#message')).toContainText('Camera ready', {timeout: 30000});
  await expect(page.locator('#lensStatus')).toHaveText('No lens correction');
  await expect(page.locator('#viewLabel')).toHaveText('PC camera · live');
});

test('full screen and every screen size keep the view and its controls together', async ({page}) => {
  await installSyntheticCamera(page);
  await page.goto('/');
  await startSyntheticCamera(page);
  await selectEnds(page, [.3, .4], [.7, .6]);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('workspace');
  await expect(page.locator('#fullscreen')).toHaveText('Exit full screen');
  for (const id of ['selectStaff', 'mirror', 'trails', 'smooth', 'fullscreen', 'view']) await expect(page.locator(`#${id}`)).toBeInViewport();
  await page.screenshot({path: `${shots}fullscreen.png`});
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  for (const [width, height] of [[390, 844], [820, 1180], [1280, 720], [1920, 1080], [2560, 1440]]) {
    await page.setViewportSize({width, height});
    await expect(page.locator('#selectText')).toHaveText('Reselect staff ends');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await obscuredControls(page)).toEqual([]);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({path: `${shots}tracking-${width}.png`});
  }
});

test('estimates draw as dashed rings, off-frame estimates stay at the edge, and labels never flicker', async ({page}) => {
  await installSyntheticCamera(page, {swing: false});
  const model = await proxyModel(page);
  await page.goto('/');
  await startSyntheticCamera(page);
  await selectEnds(page, [.3, .4], [.7, .6]);
  expect(await ringCoverage(page, .7, .6, violet)).toBeGreaterThan(.85);
  // SYNTHETIC: the fake tracker only reports visible points, so rewrite its
  // replies to exercise the estimate states the real models can return.
  const estimateB = meta => ({...meta, ends: [meta.ends[0], {...meta.ends[1], state: 'inferred'}], midpoint: {...meta.midpoint, state: 'inferred'}});
  model.rewrite = estimateB;
  await expect(page.locator('#bState')).toHaveText('Inferred');
  await expect(page.locator('#midState')).toHaveText('Inferred');
  await expect(page.locator('#trackingState')).toHaveText('One end inferred');
  await expect(page.locator('#bRow')).toHaveAttribute('data-state', 'estimated');
  // Filled A keeps its ring and centre; estimated B is a dashed ring without a centre.
  expect(near(await pixel(page, .3, .4), cyan)).toBe(true);
  expect(await ringCoverage(page, .3, .4, cyan)).toBeGreaterThan(.85);
  expect(near(await pixel(page, .7, .6), violet)).toBe(false);
  const dashed = await ringCoverage(page, .7, .6, violet);
  expect(dashed).toBeGreaterThan(.25); expect(dashed).toBeLessThan(.75);
  await page.screenshot({path: `${shots}synthetic-estimate.png`});
  // States flipping every frame never flicker the text.
  let flip = 0;
  model.rewrite = meta => (flip++ % 2 ? estimateB(meta) : meta);
  const seen = new Set();
  for (let i = 0; i < 24; i++) { seen.add(`${await page.locator('#bState').textContent()}|${await page.locator('#trackingState').textContent()}`); await page.waitForTimeout(40); }
  expect([...seen]).toEqual(['Inferred|One end inferred']);
  // An estimate outside the frame stays visible at the edge and says so.
  model.rewrite = meta => ({...meta, ends: [meta.ends[0], {...meta.ends[1], x: 1.3, state: 'inferred'}]});
  await expect(page.locator('#bState')).toHaveText('Inferred · out of view');
  await expect(page.locator('#bRow')).toHaveAttribute('data-state', 'outside');
  model.rewrite = null;
  await expect(page.locator('#bState')).toHaveText('Image estimate');
  await expect(page.locator('#trackingState')).toHaveText('Following staff shape');
});

test('without a ready model the live view keeps running and selection explains the wait', async ({page}) => {
  let status = {version: 'test', ready: false, loading: true, error: null, model: 'tapir', device: null, busy: false};
  await page.route('**/api/status', route => route.fulfill({json: status}));
  await installSyntheticCamera(page);
  await page.goto('/');
  await expect(page.locator('#modelText')).toHaveText('Loading local vision…');
  await startSyntheticCamera(page);
  await expect(page.locator('#trackingState')).toHaveText('Live view only');
  await expect(page.locator('#selectStaff')).toBeDisabled();
  await page.keyboard.press('r');
  await expect(page.locator('#message')).toHaveText('The local vision model is still loading. The live view keeps running.');
  status = {...status, loading: false, error: 'Run motion/setup.sh to install the local model'};
  await expect(page.locator('#modelText')).toHaveText('Vision setup needed', {timeout: 10000});
  await expect(page.locator('#trackingDetail')).toHaveText('The vision model is unavailable · Run motion/setup.sh to install the local model');
  const frame = await readBarcode(page, '#view', {mirror: true});
  await expect.poll(() => readBarcode(page, '#view', {mirror: true})).toBeGreaterThan(frame);
});

test('a second tab is told the model is busy, and a dropped connection asks for a new selection', async ({page, context}) => {
  await installSyntheticCamera(page);
  const model = await proxyModel(page);
  await page.goto('/');
  await startSyntheticCamera(page);
  await selectEnds(page, [.3, .4], [.7, .6]);
  const second = await context.newPage();
  await installSyntheticCamera(second);
  await second.goto('/');
  await startSyntheticCamera(second);
  await expect(second.locator('#modelText')).toHaveText('Test fixture · open in another tab', {timeout: 10000});
  await second.locator('#selectStaff').click();
  await expect(second.locator('#message')).toHaveText('Tracking is active in another tab. Stop it there first.', {timeout: 10000});
  await expect(second.locator('#viewLabel')).toHaveText('PC camera · live');
  await expect(page.locator('#trackingState')).toHaveText('Following staff shape');
  await second.close();
  // The connection drops mid-tracking (both sides, as when the server goes away).
  await model.server.close(); await model.page.close({code: 1011, reason: 'synthetic drop'});
  await expect(page.locator('#message')).toHaveText('The connection to the local model closed. The live view keeps running. Select the staff again when ready.');
  await expect(page.locator('#viewLabel')).toHaveText('PC camera · live');
  await expect(page.locator('#aState')).toHaveText('Waiting');
  // Reselecting reconnects.
  await selectEnds(page, [.4, .4], [.6, .6]);
});
