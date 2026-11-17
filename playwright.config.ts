import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Same local-database settings the other test suites use.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = Number(process.env.E2E_PORT ?? 3000);
const externalBase = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const baseURL = externalBase ?? `http://127.0.0.1:${PORT}`;

const DEMO_STATE = "tests/e2e/.auth/demo-owner.json";
const JOURNEY_FILES = /journeys\.spec\.ts|demo-phone\.spec\.ts/;
const SETUP_FILES = /auth\.setup\.ts|demo\.setup\.ts/;
const SIGNED_OUT_FILES = /api-guards\.spec\.ts/;

/**
 * End-to-end tests: a real browser, the real app and a LOCAL Supabase stack.
 *
 *   npm run db:start && npm run build && npm run test:e2e
 *
 * Two kinds of test:
 *  - Generic specs (auth, navigation, accessibility, responsive, dashboard) run as a
 *    brand-new throw-away owner with an empty business, so they never interfere.
 *  - "Journeys" run as the synthetic demo owner (`npm run seed:demo`, done
 *    automatically by the global setup) and exercise real workflows on realistic data.
 *
 * Set E2E_BASE_URL to test an already-running server instead (never production:
 * the setup steps create throw-away users and refuse a non-local database).
 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
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
    { name: "demo-setup", testMatch: /demo\.setup\.ts/ },
    {
      name: "desktop",
      testIgnore: [SETUP_FILES, JOURNEY_FILES, SIGNED_OUT_FILES],
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      testIgnore: [SETUP_FILES, JOURNEY_FILES, SIGNED_OUT_FILES],
      dependencies: ["setup"],
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "journeys",
      testMatch: /journeys\.spec\.ts/,
      dependencies: ["demo-setup"],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], storageState: DEMO_STATE },
    },
    {
      name: "journeys-phone",
      testMatch: /demo-phone\.spec\.ts/,
      dependencies: ["demo-setup"],
      use: { ...devices["Pixel 7"], storageState: DEMO_STATE },
    },
    { name: "signed-out", testMatch: SIGNED_OUT_FILES, use: { ...devices["Desktop Chrome"] } },
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
