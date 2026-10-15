import {expect} from '@playwright/test';
import {phonePacket as pack} from './synthetic.mjs';

// Splits a binary tracking packet: two big-endian lengths, JSON metadata, JPEG.
export function unpack(buffer) {
  const metaLength = buffer.readUInt32BE(0), jpegLength = buffer.readUInt32BE(4);
  return {meta: JSON.parse(buffer.subarray(8, 8 + metaLength).toString()), jpeg: buffer.subarray(8 + metaLength, 8 + metaLength + jpegLength)};
}

// Sits between the page and the fixture server on /ws/track. It records every
// request and reply, can hold replies to create in-flight races on purpose, and
// can rewrite the fixture's point states (marked synthetic in the tests using it).
export async function proxyModel(page) {
  const model = {sent: [], replies: [], held: [], hold: false, rewrite: null, page: null};
  model.frames = () => model.sent.filter(entry => entry.frame);
  model.commands = type => model.sent.filter(entry => entry.command?.type === type);
  model.delivered = () => model.replies.filter(reply => reply.delivered);
  model.release = () => { model.hold = false; for (const reply of model.held.splice(0)) { reply.delivered = true; model.page.send(reply.raw); } };
  await page.routeWebSocket(/\/ws\/track$/, ws => {
    const server = ws.connectToServer();
    model.page = ws; model.server = server;
    ws.onMessage(message => {
      if (typeof message === 'string') model.sent.push({command: JSON.parse(message)});
      else { const {meta, jpeg} = unpack(message); model.sent.push({frame: meta, jpeg}); }
      server.send(message);
    });
    server.onMessage(message => {
      const reply = typeof message === 'string' ? {text: JSON.parse(message)} : {...unpack(message), packet: true};
      if (reply.packet && model.rewrite) { reply.meta = model.rewrite(reply.meta); message = pack(reply.meta, reply.jpeg); }
      reply.raw = message; model.replies.push(reply);
      if (model.hold && reply.packet) model.held.push(reply);
      else { reply.delivered = true; ws.send(message); }
    });
  });
  return model;
}

// The fixture server allows one tracking connection. Wait until the last test's closed.
export async function serverIdle(request) {
  await expect.poll(async () => (await (await request.get('/api/status')).json()).busy, {timeout: 10000}).toBe(false);
}

// Screen position of normalised display coordinates inside the letterboxed view.
export async function viewPoint(page, x, y, selector = '#view') {
  return page.locator(selector).evaluate((canvas, [x, y]) => {
    const box = canvas.getBoundingClientRect(), scale = Math.min(box.width / canvas.width, box.height / canvas.height);
    const width = canvas.width * scale, height = canvas.height * scale;
    return {x: box.left + (box.width - width) / 2 + x * width, y: box.top + (box.height - height) / 2 + y * height};
  }, [x, y]);
}
export async function clickView(page, x, y) {
  const point = await viewPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

// RGB at normalised display coordinates of a canvas (already mirrored if shown so).
export function pixel(page, x, y, selector = '#view') {
  return page.locator(selector).evaluate((canvas, [x, y]) => {
    const px = Math.min(canvas.width - 1, Math.round(x * canvas.width)), py = Math.min(canvas.height - 1, Math.round(y * canvas.height));
    return [...canvas.getContext('2d').getImageData(px, py, 1, 1).data.slice(0, 3)];
  }, [x, y]);
}
export const near = (rgb, target, tolerance = 40) => rgb.every((value, i) => Math.abs(value - target[i]) <= tolerance);
export const hex = color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));

export async function startSyntheticCamera(page) {
  await page.locator('#camera').click();
  await expect(page.locator('#message')).toContainText('Camera ready', {timeout: 30000});
}

// Freezes a still frame and clicks both ends at display coordinates.
export async function selectEnds(page, a, b) {
  await page.locator('#selectStaff').click();
  await expect(page.locator('#viewLabel')).toHaveText('Still frame');
  await clickView(page, ...a);
  await expect(page.locator('#instructionTitle')).toHaveText('Click end B');
  await clickView(page, ...b);
  await expect(page.locator('#trackingState')).toHaveText('Following staff shape');
}

// Controls that are missing, off screen sideways, or covered by another element.
export function obscuredControls(page) {
  return page.evaluate(() => [...document.querySelectorAll('.sources button, .sources select, aside button, .view-bar input, .playback button, .playback input, .playback select, #fullscreen')]
    .filter(control => !control.closest('[hidden]'))
    .filter(control => {
      control.scrollIntoView({block: 'center', inline: 'nearest'});
      const box = control.getBoundingClientRect();
      if (!box.width || !box.height || box.left < 0 || box.right > innerWidth) return true;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !(hit === control || control.contains(hit) || hit?.closest('label')?.contains(control));
    })
    .map(control => control.id || control.textContent.trim()));
}

// Share of samples on a ring around display point (x, y) that match a colour:
// near 1 for a solid ring, clearly lower for a dashed one.
export function ringCoverage(page, x, y, color, radius = 19) {
  return page.locator('#view').evaluate((canvas, [x, y, color, radius]) => {
    const box = canvas.getBoundingClientRect(), shown = Math.min(box.width, box.height * canvas.width / canvas.height);
    const r = radius * Math.min(1.4, Math.max(.7, shown / 1200)) * canvas.width / shown, ctx = canvas.getContext('2d');
    let hits = 0;
    // A small band of radii absorbs the pixel rounding of a mouse click.
    for (let i = 0; i < 90; i++) {
      const angle = i / 90 * Math.PI * 2;
      hits += [-1.5, -.75, 0, .75, 1.5].some(offset => {
        const px = Math.round(x * canvas.width + Math.cos(angle) * (r + offset)), py = Math.round(y * canvas.height + Math.sin(angle) * (r + offset));
        const [red, green, blue] = ctx.getImageData(px, py, 1, 1).data;
        return Math.abs(red - color[0]) <= 45 && Math.abs(green - color[1]) <= 45 && Math.abs(blue - color[2]) <= 45;
      });
    }
    return hits / 90;
  }, [x, y, color, radius]);
}
