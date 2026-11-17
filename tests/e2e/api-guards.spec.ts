import { expect, test } from "@playwright/test";

// Signed-out callers. These run in the "signed-out" project (no stored session).
test.describe("protected endpoints", () => {
  test("data, report and job endpoints refuse signed-out requests", async ({ request }) => {
    expect((await request.get("/api/export/drivers")).status()).toBe(401);
    expect((await request.get("/api/reports/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    expect((await request.get("/api/files/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    expect((await request.get("/api/cron/tick")).status()).toBe(401);
    // Refused either way: 403 (bad signature) or 503 (Dropbox not configured on this server).
    expect([403, 503]).toContain((await request.post("/api/dropbox/webhook", { data: "{}" })).status());
  });
});

test.describe("forms", () => {
  test("a rejected sign-in keeps the email address but never the password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill("someone@example.test");
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue("someone@example.test");
    await expect(page.getByLabel("Password")).toHaveValue("");
  });

  test("an error message is not read out as part of the field's name", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click(); // empty form
    await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  });
});
