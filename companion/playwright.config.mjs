import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser-tests",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8788",
    headless: true,
    launchOptions: { executablePath: process.env.KLOBFLOW_BROWSER },
  },
  webServer: process.env.CI
    ? {
        command: "node server.mjs",
        url: "http://127.0.0.1:8788",
        reuseExistingServer: false,
      }
    : undefined,
});
