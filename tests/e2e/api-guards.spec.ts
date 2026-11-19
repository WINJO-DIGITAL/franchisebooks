import { expect, test } from "@playwright/test";

// Signed-out callers. These run in the "signed-out" project (no stored session).
test.describe("protected endpoints", () => {
  test("data, report and job endpoints refuse signed-out requests", async ({ request }) => {
    expect((await request.get("/api/export/drivers")).status()).toBe(401);
    expect((await request.get("/api/reports/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    expect((await request.get("/api/files/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    expect((await request.get("/api/cron/tick")).status()).toBe(401);
    expect((await request.get("/api/statements/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    expect((await request.get("/api/statements/zip?period=2026-10-12")).status()).toBe(401);
    expect((await request.get("/api/my/statements/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    expect((await request.get("/api/unreadable-documents/00000000-0000-0000-0000-000000000000")).status()).toBe(401);
    // Refused either way: 403 (bad signature) or 503 (Dropbox not configured on this server).
    expect([403, 503]).toContain((await request.post("/api/dropbox/webhook", { data: "{}" })).status());
  });
});

test.describe("forms", () => {
  test("a rejected sign-in keeps what was typed so it can be corrected", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").fill("someone@example.test");
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue("someone@example.test");
    await expect(page.getByLabel("Password")).toHaveValue("definitely-wrong-password");
  });

  test("an error message is not read out as part of the field's name", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click(); // empty form
    await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  });
});

test.describe("public terms page", () => {
  test("shows the Terms & Conditions to a signed-out visitor, with all 20 sections and the contact details", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByRole("heading", { level: 1, name: "Terms & Conditions" })).toBeVisible();
    await expect(page.getByText("Last updated 19 November 2026")).toBeVisible();
    const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
    for (let n = 1; n <= 20; n++) expect(headings.some((h) => h.startsWith(`${n}. `))).toBe(true);
    expect(headings).toContain("Important Notice");
    await expect(page.getByText(/Nitisat Sirisom/)).toBeVisible();
    await expect(page.getByText(/processed by Stripe\. No VAT is charged/)).toBeVisible();
    await expect(page.getByRole("link", { name: "hello@winjodigital.co.uk" }).first()).toHaveAttribute("href", "mailto:hello@winjodigital.co.uk");
    await expect(page.getByText("[Insert")).toHaveCount(0);
  });

  test("the terms and privacy pages carry no draft or solicitor-review notice", async ({ page }) => {
    for (const path of ["/terms", "/privacy"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText(/solicitor|^Draft\b/i)).toHaveCount(0);
    }
  });
});
