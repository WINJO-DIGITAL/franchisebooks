import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { CREDENTIALS_FILE, expectNoErrorScreen, OWNER_FILE, type Credentials } from "./helpers";

test.use({ storageState: OWNER_FILE });

test.describe("dashboard", () => {
  test("loads for a signed-in owner without an error screen", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoErrorScreen(page);
  });

  test("shows who is signed in and a way to reach alerts", async ({ page, isMobile }) => {
    const { businessName } = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8")) as Credentials;
    await page.goto("/");
    await expect(page.getByRole("link", { name: /alerts/i }).first()).toBeVisible();
    if (!isMobile) await expect(page.getByText(businessName).first()).toBeVisible();
  });

  test("has a skip-free, single main landmark and one top-level heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("an unknown address shows the friendly not-found page", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
    await page.getByRole("link", { name: "Go to the dashboard" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("the health check is public and says the app is up", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect((await response.json()).checks.app).toBe("ok");
  });
});
