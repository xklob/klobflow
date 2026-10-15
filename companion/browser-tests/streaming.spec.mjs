import { test, expect } from "@playwright/test";
import http from "node:http";
import { demoFrame, defaults } from "../public/demo.mjs";

test.beforeEach(async ({request}) => {await request.post("/api/disconnect",{data:{}});});

test("continuous preview, reconnect, zoom, and four-corner calibration controls", async ({ page }) => {
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.addInitScript(()=>{
    window.overlayStrokes=[];window.overlayLabels=[];
    const proto=CanvasRenderingContext2D.prototype,clear=proto.clearRect,stroke=proto.stroke,fillText=proto.fillText;
    proto.clearRect=function(...args){if(this.canvas.id==='view'){window.overlayStrokes=[];window.overlayLabels=[];}return clear.apply(this,args);};
    proto.stroke=function(...args){if(this.canvas.id==='view')window.overlayStrokes.push(this.strokeStyle);return stroke.apply(this,args);};
    proto.fillText=function(...args){if(this.canvas.id==='view')window.overlayLabels.push(args[0]);return fillText.apply(this,args);};
  });
  await page.goto("/");
  const jpeg = Buffer.from(await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 960; c.height = 720;
    c.getContext("2d").fillStyle="#345678";c.getContext("2d").fillRect(0, 0, 960, 720);
    return c.toDataURL("image/jpeg").split(",")[1];
  }), "base64");
  let config = { ...defaults,tempoEnabled:true }, commands = [], streams = 0, activeStream, holdFrames=false,recording=false;
  const phone = http.createServer(async (req, res) => {
    if (req.url === "/api/live") return res.end(JSON.stringify({ protocol: 2, version: "0.2.0" }));
    if (req.url === "/api/sessions") return res.end('{"sessions":[]}');
    if (req.url === "/api/control") {
      let body = ""; for await (const c of req) body += c;
      const command = JSON.parse(body); commands.push(command);
      config = { ...config, ...command.config };
      if(command.action==="record")recording=true;if(command.action==="stop")recording=false;
      if (command.action === "calibrate") config.planeCorners = command.points;
      return res.end(JSON.stringify({ ok: true, config }));
    }
    if (req.url === "/api/stream") {
      streams++; activeStream = res;
      res.writeHead(200, { "Content-Type": "application/x-klobflow-stream" });
      const timer = setInterval(() => {
        if(holdFrames)return;
        const frame = { ...demoFrame(config, Date.now()), source: "camera", cameraReady: true, recording,elapsedMs:1000, zoom: { min: .7, max: 8, ratio: config.zoom || .7 } };
        const json = Buffer.from(JSON.stringify(frame)), head = Buffer.alloc(8);
        head.writeUInt32BE(json.length); head.writeUInt32BE(jpeg.length, 4);
        res.write(Buffer.concat([head, json, jpeg]));
      }, 33);
      res.on("close", () => clearInterval(timer)); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => phone.listen(0, "127.0.0.1", resolve));
  try {
    await page.locator("#pair-open").click();
    await expect(page.locator("#phone-token")).toHaveCount(0);
    await page.locator("#transport").selectOption("lan");
    await page.locator("#phone-address").fill(`127.0.0.1:${phone.address().port}`);
    await page.locator("#pair-submit").click();
    await expect(page.locator("#source-label")).toHaveText("LIVE FROM YOUR PHONE");
    await expect(page.locator("#coaching-title")).toHaveText(/ON GUIDE|OFF GUIDE|TIPS ON TARGET|% ON TARGET/);
    await page.locator('[data-config="showFeedback"]').uncheck();
    await expect.poll(()=>commands.some(c=>c.config?.showFeedback===false)).toBe(true);
    await expect(page.locator('#coaching-detail')).not.toContainText(/amber|along.*arrow|white TARGET/,{timeout:750});
    await page.locator('[data-config="showFeedback"]').check();
    await expect(page.locator("#camera-info")).toContainText("preview fps");
    await expect(page.locator("#zoom")).toHaveAttribute("min", "0.7");
    await page.locator("#zoom").fill("2"); await page.locator("#zoom").dispatchEvent("change");
    await expect.poll(() => commands.some(c => c.config?.zoom === 2)).toBe(true);
    await expect(page.locator('#tolerance')).toHaveAttribute('max','50');
    await page.locator('#tolerance').fill('35');await page.locator('#tolerance').dispatchEvent('change');
    await expect.poll(()=>commands.some(c=>c.config?.tolerance===35)).toBe(true);
    await expect.poll(()=>page.evaluate(()=>window.overlayLabels.includes('BEAT TIP'))).toBe(true);
    await page.locator('#record').click();await expect(page.locator('#record')).toContainText('Stop');
    holdFrames=true;
    await expect(page.locator('#source-label')).toHaveText('CAMERA PAUSED');
    await expect(page.locator('#streak-hud')).toBeHidden();await expect(page.locator('#beat-feedback')).toBeHidden();
    expect(await page.evaluate(()=>window.overlayLabels.some(t=>t==='TARGET'||t==='BEAT TIP'||t.startsWith('TIP ')))).toBe(false);
    expect(await page.evaluate(()=>window.overlayStrokes.includes('#ffffff'))).toBe(false);
    const retained=await page.locator('#view').evaluate(c=>[...c.getContext('2d').getImageData(3,3,1,1).data]);expect(retained[3]).toBe(255);expect(retained[2]).toBeGreaterThan(100);
    await expect(page.locator('#record')).toBeEnabled();await page.locator('#record').click();await expect.poll(()=>commands.some(c=>c.action==='stop')).toBe(true);
    holdFrames=false;await expect(page.locator('#source-label')).toHaveText('LIVE FROM YOUR PHONE');
    await expect(page.locator('#beat-feedback')).toBeVisible();
    activeStream.destroy();
    await expect(page.locator("#source-label")).toHaveText("CAMERA PAUSED");
    await expect.poll(() => streams, { timeout: 10000 }).toBeGreaterThan(1);
    await expect(page.locator("#source-label")).toHaveText("LIVE FROM YOUR PHONE");
    for (const control of ["#seed", "#calibrate"]) {
      await page.locator(control).click();
      const before = await page.locator("#view").evaluate(c => c.toDataURL());
      await expect.poll(() => page.locator("#view").evaluate(c => c.toDataURL())).not.toBe(before);
      await page.locator(control).click();
    }
    await page.locator("#calibrate").click();
    await page.locator("#view").scrollIntoViewIfNeeded();
    const box = await page.locator("#view").boundingBox();
    for (const [x, y] of [[.15, .15], [.85, .2], [.8, .85], [.2, .8]])
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
    await expect.poll(() => commands.some(c => c.action === "calibrate" && c.points.length === 4 && c.aspect === 1)).toBe(true);
    await expect(page.locator("#calibration-info")).toContainText("Perspective correction active");
    expect(errors).toEqual([]);
  } finally {
    await page.request.post("/api/disconnect", { data: {} });
    phone.closeAllConnections(); await new Promise(resolve => phone.close(resolve));
  }
});
