import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const inCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  outputDir: "./.results",
  fullyParallel: false,
  workers: 1,
  retries: inCi ? 1 : 0,
  reporter: inCi ? [["list"], ["html", { open: "never", outputFolder: "./.report" }]] : "list",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["setup"],
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: "e2e/.auth/admin.json" }
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      testMatch: /(mobile|review-portrait)\.spec\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, storageState: "e2e/.auth/admin.json" }
    }
  ],
  webServer: [
    {
      command: "npm run dev -w @videocat/server",
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: !inCi,
      timeout: 120_000
    },
    {
      command: "npm run dev -w @videocat/web",
      url: baseURL,
      reuseExistingServer: !inCi,
      timeout: 120_000
    }
  ]
});
