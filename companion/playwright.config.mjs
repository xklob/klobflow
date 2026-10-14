import { defineConfig } from "@playwright/test";
// Tests disconnect/pair their relay. Always give them a separate server so a
// running practice session on the normal companion port is never interrupted.
const port = Number(process.env.KLOBFLOW_TEST_PORT || 8878);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./browser-tests",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    launchOptions: { executablePath: process.env.KLOBFLOW_BROWSER },
  },
  webServer: {
    command: "node server.mjs",
    env: { KLOBFLOW_PORT: String(port) },
    url: baseURL,
    reuseExistingServer: false,
  },
});
