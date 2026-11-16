import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Same local-database settings the other test suites use.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = Number(process.env.E2E_PORT ?? 3000);
const externalBase = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const baseURL = externalBase ?? `http://127.0.0.1:${PORT}`;

/**
 * End-to-end tests against a real browser, the real app and a LOCAL Supabase stack.
 *
 *   npm run db:start && npm run build && npm run test:e2e
 *
 * The app must be built first (`npm run build`); the server is started for you.
 * Set E2E_BASE_URL to test an already-running server instead (never production:
 * the setup step creates throw-away users and refuses a non-local database).
 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  // Ordinary journeys are independent; the setup project runs first.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: "en-GB",
    timezoneId: "Europe/London",
    trace: "off", // turn on with --trace on when debugging a failure
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: externalBase
    ? undefined
    : {
        command: `npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
