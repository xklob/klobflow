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
