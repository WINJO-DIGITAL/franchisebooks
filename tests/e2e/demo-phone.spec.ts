import { expect, test } from "@playwright/test";

const PAGES = ["/", "/drivers", "/earnings", "/expenses", "/adjustments", "/adjustments/new", "/reports", "/data", "/settings", "/alerts", "/menu"];

test.describe("mobile layout", () => {
  for (const path of PAGES) {
    test(`${path} fits a phone screen without sideways scrolling`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `page is ${overflow}px wider than the screen`).toBeLessThanOrEqual(1);
      await expect(page.getByRole("navigation", { name: "Main" }).last()).toBeVisible();
    });
  }

  test("uses bottom navigation on a phone", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" }).last();
    await expect(nav.getByRole("link", { name: "Drivers" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "More" })).toBeVisible();
    await nav.getByRole("link", { name: "More" }).click();
    await expect(page.getByRole("link", { name: "Data & Integrations" })).toBeVisible();
  });
});
