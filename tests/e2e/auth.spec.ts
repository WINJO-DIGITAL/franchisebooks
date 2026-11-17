import { expect, test } from "@playwright/test";

test.describe("authentication", () => {
  test("signed-out visitors are sent to the sign-in page and remember where they were going", async ({ page }) => {
    await page.goto("/earnings");
    await expect(page).toHaveURL(/\/login\?next=%2Fearnings/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("protected data endpoints refuse signed-out requests", async ({ request }) => {
    expect((await request.get("/api/export/drivers")).status()).toBe(401);
    expect((await request.get("/api/reports/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    expect((await request.get("/api/cron/tick")).status()).toBe(401);
    // Refused either way: 403 (bad signature) or 503 (Dropbox not configured on this server).
    expect([403, 503]).toContain((await request.post("/api/dropbox/webhook", { data: "{}" })).status());
  });

  test("a wrong password gets a plain-English message, not a technical error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill("demo@example.test");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That email and password do not match. Please try again.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signing in lands on the dashboard, and signing out returns to sign-in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill("demo@example.test");
    await page.getByLabel("Password").fill("demo-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });
});
