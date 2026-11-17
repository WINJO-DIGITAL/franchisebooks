import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off", locale: "en-GB", timezoneId: "Europe/London" },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", testIgnore: /auth\.setup\.ts|auth\.spec\.ts/, use: { ...devices["Desktop Chrome"], storageState: "tests/e2e/.auth/owner.json" }, dependencies: ["setup"] },
    { name: "mobile", testMatch: /responsive\.spec\.ts/, use: { ...devices["Pixel 7"], storageState: "tests/e2e/.auth/owner.json" }, dependencies: ["setup"] },
    { name: "signed-out", testMatch: /auth\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
});
