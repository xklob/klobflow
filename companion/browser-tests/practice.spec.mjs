import { test, expect } from "@playwright/test";
test.beforeEach(async ({request}) => {await request.post("/api/disconnect",{data:{}});});

test("practice demo, guide controls, pairing errors and mobile layout", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#empty-state")).toBeVisible();
  await page.getByRole("button", { name: "Explore a demo" }).click();
  await expect(page.locator("#stage-badge")).toHaveText(
    "DEMO · GENERATED MOTION",
  );
  await expect(page.locator("#tracking-label")).toContainText(
    "Both staves tracked",
  );
  await expect(page.locator("#deviation")).not.toContainText("—");
  await page.locator('[data-mode="cube"]').click();
  await expect(page.locator("#depth-control")).toBeVisible();
  await page.locator('[data-mode="circles"]').click();
  await expect(page.locator("#circles-control")).toBeVisible();
  await page.locator('[data-mode="free"]').click();
  await expect(page.locator("#deviation")).toContainText("—");
  await page.locator('[data-mode="grid"]').click();
  await page.screenshot({
    path: "../review/companion-desktop.png",
    fullPage: true,
  });
  await page.locator("#pair-open").click();
  await page.locator("#transport").selectOption("lan");
  await page.locator("#phone-address").fill("8.8.8.8");

  await page.locator("#pair-submit").click();
  await expect(page.locator("#pair-error")).toContainText("private LAN");
  await page.locator("#cancel-pair").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "../review/companion-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("analysis replay keeps missing scores and scrubs samples", async ({
  page,
}) => {
  await page.goto("/");
  const { demoFrame, defaults } = await import("../public/demo.mjs");
  const frames = [demoFrame(defaults, 1000), demoFrame(defaults, 1100)];
  frames[1].metrics.deviation = null;
  frames.forEach((f, i) => (f.elapsedMs = i * 100));
  const content = [{ type: "header", schema: 1 }, ...frames]
    .map((x) => JSON.stringify(x))
    .join("\n");
  await page
    .locator("#import-analysis")
    .setInputFiles({
      name: "practice.jsonl",
      mimeType: "application/x-ndjson",
      buffer: Buffer.from(content),
    });
  await expect(page.locator("#stage-badge")).toHaveText(
    "ANALYSIS REPLAY · NO VIDEO",
  );
  await page.locator("#scrubber").fill("1");
  await page.locator("#scrubber").dispatchEvent("input");
  await expect(page.locator("#deviation")).toContainText("—");
  await expect(page.locator("#record")).toBeDisabled();
  await page.locator("#return-live").click();
  await expect(page.locator("#empty-state")).toBeVisible();
});

test('each mode tutorial dismisses independently and single-staff beat practice works',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Explore a demo'}).click();
 for(const mode of ['grid','circles','cube','free','antispin']){
  await page.locator(`[data-mode="${mode}"]`).click();await expect(page.locator('#mode-tutorial')).toBeVisible();
  await expect(page.locator('#tutorial-steps li')).toHaveCount(4);await page.locator('#dismiss-tutorial').click();await expect(page.locator('#mode-tutorial')).toBeHidden();
 }
 await page.locator('[data-mode="circles"]').click();await expect(page.locator('#mode-tutorial')).toBeHidden();await page.locator('#show-tutorial').click();await expect(page.locator('#mode-tutorial')).toBeVisible();
 await page.locator('#staff-count').selectOption('1');await expect(page.locator('#tracking-label')).toContainText('One staff tracked');await expect(page.locator('#symmetry')).toContainText('—');
 await page.locator('[data-config="tempoEnabled"]').check();await page.locator('#bpm').fill('90');await page.locator('#bpm').dispatchEvent('change');
 await page.getByText('How beat practice works',{exact:true}).click();await expect(page.locator('.beat-help')).toContainText('75 milliseconds');await page.getByText('How beat practice works',{exact:true}).click();
 await expect(page.locator('#beat-feedback')).toBeVisible();await expect(page.locator('#beat-pulse')).toContainText('90 BPM');
 await expect(page.locator('#beat-hits')).toContainText(/point [1-4]:/,{timeout:12000});
 await page.screenshot({path:'../review/practice-timing.png',fullPage:true});
});

test('linear antispin supports two staves and explains each axis and its beats',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await page.getByRole('button',{name:'Explore a demo'}).click();
 await page.locator('[data-mode="antispin"]').click();await expect(page.locator('#staff-count')).toHaveValue('2');await expect(page.locator('#staff-count')).toBeEnabled();await page.locator('#staff-count').selectOption('1');
 await expect(page.locator('#tutorial-title')).toContainText('Linear antispin');await expect(page.locator('#error-label')).toHaveText('LINE DRIFT');await expect(page.locator('#angle').locator('..')).toBeHidden();
 await expect(page.locator('#coaching-detail')).toContainText('Horizontal tip:',{timeout:10000});await expect(page.locator('#coaching-detail')).toContainText('Vertical tip:');
 await page.locator('[data-config="tempoEnabled"]').check();await page.getByText('How beat practice works',{exact:true}).click();
 await expect(page.locator('#antispin-beat-help')).toBeVisible();await expect(page.locator('#normal-beat-help')).toBeHidden();await expect(page.locator('[data-config="beatPoints"]')).toBeHidden();
 await expect(page.locator('#beat-hits')).toContainText('turnaround',{timeout:12000});await page.locator('#fullscreen').click();await expect(page.locator('#exit-fullscreen')).toBeVisible();
 const stage=await page.locator('#stage').boundingBox(),hud=await page.locator('#streak-hud').boundingBox();expect(hud.y).toBeGreaterThanOrEqual(stage.y+stage.height);
 await page.screenshot({path:'../review/080-antispin-fullscreen.png'});await page.locator('#exit-fullscreen').click();
 await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('[data-mode="grid"]').click();await expect(page.locator('#staff-count')).toBeEnabled();await expect(page.locator('[data-config="beatPoints"]')).toBeVisible();
 expect(errors).toEqual([]);
});

test('alignment streak builds, resets, disables and respects free flow',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/');await page.getByRole('button',{name:'Explore a demo'}).click();
 await page.locator('[data-mode="circles"]').click();await page.locator('#staff-count').selectOption('1');
 await page.locator('[data-config="scale"]').fill('0.23');await page.locator('[data-config="scale"]').dispatchEvent('change');
 await expect(page.locator('#streak-title')).toContainText('GLOW',{timeout:12000});
 await expect(page.locator('#streak-power').locator('..')).toHaveAttribute('aria-valuemax','30');
 await expect(page.locator('#streak-title')).toContainText('MAX POWER',{timeout:40000});
 await expect(page.locator('#streak-power')).toHaveAttribute('style',/100%/);
 await page.setViewportSize({width:1920,height:1080});await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:'../review/web-streak.png'});
 await page.locator('[data-config="scale"]').fill('0.4');await page.locator('[data-config="scale"]').dispatchEvent('change');
 await expect(page.locator('#streak-title')).toContainText('BUILD YOUR STREAK');
 await page.locator('[data-config="streakEffects"]').uncheck();await expect(page.locator('#streak-hud')).toBeHidden();
 await page.locator('[data-config="streakEffects"]').check();await page.locator('[data-mode="free"]').click();
 await expect(page.locator('#streak-title')).toContainText('without alignment streaks');
 await expect(page.locator('#streak-power')).toHaveAttribute('style',/0%/);expect(errors).toEqual([]);
});

test('large-text beat practice keeps the preview on screen and coaching in fullscreen',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});await page.goto('/');
 await page.getByRole('button',{name:'Explore a demo'}).click();
 await page.locator('[data-config="tempoEnabled"]').check();
 await page.locator('#ui-size').selectOption('large');
 await expect(page.locator('#beat-hits')).toContainText('point',{timeout:12000});
 await page.waitForTimeout(3000);
 await page.evaluate(()=>window.scrollTo(0,0));
 await expect.poll(()=>page.locator('#stage').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight+1)).toBe(true);
 expect(await page.locator('.small-note').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(20);
 await page.locator('#fullscreen').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
 await expect(page.locator('#coaching')).toBeVisible();await expect(page.locator('#beat-feedback')).toBeVisible();
 await page.locator('#exit-fullscreen').click();await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
 await page.reload();await expect(page.locator('#ui-size')).toHaveValue('large');
});

test('quick setup actions and short tutorials stay discoverable',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});await page.goto('/');
 await expect(page.locator('#quick-fit')).toBeDisabled();await expect(page.locator('#quick-background')).toBeDisabled();
 await page.locator('#demo-start').click();
 await expect(page.locator('#tutorial-steps li').first()).toBeVisible();await expect(page.locator('#tutorial-steps li').nth(1)).toBeHidden();
 await page.locator('#tutorial-expand').click();await expect(page.locator('#tutorial-steps li').nth(3)).toBeVisible();
 await page.locator('#tutorial-expand').click();await expect(page.locator('#tutorial-steps li').nth(1)).toBeHidden();
 await page.locator('#quick-lights').click();await expect(page.locator('[data-color=""]')).toBeFocused();
 await page.locator('[data-color="red"]').click();await expect(page.locator('#color-summary')).toContainText('Red');
 await page.locator('.legend-help summary').click();await expect(page.locator('.feedback-legend')).toBeVisible();
 await page.locator('.legend-help summary').click();await expect(page.locator('.feedback-legend')).toBeHidden();
});

test('a rejected demo setting restores its value and later changes still apply',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Explore a demo'}).click();
 await page.locator('#bpm').fill('500');await page.locator('#bpm').dispatchEvent('change');await expect(page.locator('#bpm')).toHaveValue('120');
 await page.locator('#bpm').fill('105');await page.locator('#bpm').dispatchEvent('change');await expect(page.locator('#bpm')).toHaveValue('105');
 await page.locator('[data-mode="antispin"]').click();await expect(page.locator('[data-mode="antispin"]')).toHaveClass(/active/);
});

test('live trails cover the full rainbow and older marks fade without changing color',async({page})=>{
 await page.addInitScript(()=>{
  const proto=CanvasRenderingContext2D.prototype,style=Object.getOwnPropertyDescriptor(proto,'strokeStyle');window.trailColors={};
  Object.defineProperty(proto,'strokeStyle',{...style,set(value){
   const match=typeof value==='string'&&value.match(/^hsl\(([\d.]+) /);
   if(this.canvas.id==='view'&&match){const hue=Number(match[1]),key=hue.toFixed(4),record=window.trailColors[key]??={hue,minAlpha:this.globalAlpha,maxAlpha:this.globalAlpha};record.minAlpha=Math.min(record.minAlpha,this.globalAlpha);record.maxAlpha=Math.max(record.maxAlpha,this.globalAlpha);}
   style.set.call(this,value);
  }});
 });
 await page.goto('/');await page.locator('#demo-start').click();
 await expect.poll(()=>page.evaluate(()=>new Set(Object.values(window.trailColors).map(x=>Math.floor(x.hue/60))).size),{timeout:7000}).toBe(6);
 // A timestamp keeps the same hue while its opacity decreases over later renders.
 await expect.poll(()=>page.evaluate(()=>Object.values(window.trailColors).some(x=>x.maxAlpha-x.minAlpha>.4)),{timeout:7000}).toBe(true);
});
