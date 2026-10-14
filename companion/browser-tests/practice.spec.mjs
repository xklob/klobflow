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
 for(const mode of ['grid','circles','cube','free']){
  await page.locator(`[data-mode="${mode}"]`).click();await expect(page.locator('#mode-tutorial')).toBeVisible();
  await expect(page.locator('#tutorial-steps li')).toHaveCount(4);await page.locator('#dismiss-tutorial').click();await expect(page.locator('#mode-tutorial')).toBeHidden();
 }
 await page.locator('[data-mode="circles"]').click();await expect(page.locator('#mode-tutorial')).toBeHidden();await page.locator('#show-tutorial').click();await expect(page.locator('#mode-tutorial')).toBeVisible();
 await page.locator('#staff-count').selectOption('1');await expect(page.locator('#tracking-label')).toContainText('One staff tracked');await expect(page.locator('#symmetry')).toContainText('—');
 await page.locator('[data-config="tempoEnabled"]').check();await page.locator('#bpm').fill('90');await page.locator('#bpm').dispatchEvent('change');
 await expect(page.locator('#beat-feedback')).toBeVisible();await expect(page.locator('#beat-pulse')).toContainText('90 BPM');
 await expect(page.locator('#beat-hits')).toContainText(/point [1-4]:/,{timeout:12000});
 await page.screenshot({path:'../review/practice-timing.png',fullPage:true});
});

test('alignment streak builds, resets, disables and respects free flow',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/');await page.getByRole('button',{name:'Explore a demo'}).click();
 await page.locator('[data-mode="circles"]').click();await page.locator('#staff-count').selectOption('1');
 await page.locator('[data-config="scale"]').fill('0.23');await page.locator('[data-config="scale"]').dispatchEvent('change');
 await expect(page.locator('#streak-title')).toContainText('LEVEL 4',{timeout:20000});
 await expect(page.locator('#streak-power')).toHaveAttribute('style',/100%/);
 await page.screenshot({path:'../review/web-streak.png',fullPage:true});
 await page.locator('[data-config="scale"]').fill('0.4');await page.locator('[data-config="scale"]').dispatchEvent('change');
 await expect(page.locator('#streak-title')).toContainText('BUILD YOUR STREAK');
 await page.locator('[data-config="streakEffects"]').uncheck();await expect(page.locator('#streak-hud')).toBeHidden();
 await page.locator('[data-config="streakEffects"]').check();await page.locator('[data-mode="free"]').click();
 await expect(page.locator('#streak-title')).toContainText('without alignment streaks');
 await expect(page.locator('#streak-power')).toHaveAttribute('style',/0%/);expect(errors).toEqual([]);
});
