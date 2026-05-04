import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 7_000
  },
  use: {
    baseURL: "http://127.0.0.1:5176",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node ./tests/start-e2e.mjs",
    url: "http://127.0.0.1:5176",
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] }
    }
  ]
});
