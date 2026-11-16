import { expect, test } from "@playwright/test";
import { EXTRA_ROUTES, isNotBuilt, NAV_ROUTES, OWNER_FILE } from "./helpers";

test.use({ storageState: OWNER_FILE });

test.describe("navigation on desktop", () => {
  test.beforeEach(({ isMobile }) => test.skip(isMobile, "Desktop layout only"));

  test("the sidebar lists every section, in order, and marks the current page", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    const labels = await nav.getByRole("link").allInnerTexts();
    expect(labels.map((l) => l.replace(/\d+$/, "").trim())).toEqual(NAV_ROUTES.map((r) => r.label));
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  });

  for (const route of NAV_ROUTES) {
    test(`"${route.label}" opens ${route.href}`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: route.label, exact: false }).first().click();
      await page.waitForURL((url) => url.pathname === route.href);
      if (await page.getByRole("heading", { name: "We could not find that page" }).isVisible()) test.skip(true, `${route.href} is not built on this branch yet`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: route.label })).toHaveAttribute("aria-current", "page");
    });
  }

  test("the bottom bar is not shown on a wide screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1); // sidebar only (the bottom bar is hidden, not removed)
    await expect(page.getByRole("link", { name: "More" })).toBeHidden();
  });
});

test.describe("navigation on a phone", () => {
  test.beforeEach(({ isMobile }) => test.skip(!isMobile, "Phone layout only"));

  test("the bottom bar shows the four main sections and More", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByRole("navigation", { name: "Main" }).last();
    await expect(bar).toBeVisible();
    for (const label of ["Dashboard", "Drivers", "Earnings", "Adjustments", "More"]) {
      await expect(bar.getByRole("link", { name: label })).toBeVisible();
    }
  });

  test("More lists the remaining sections and each one opens", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Main" }).last().getByRole("link", { name: "More" }).click();
    await expect(page).toHaveURL(/\/menu$/);
    for (const label of ["Fuel & Expenses", "Reports", "Alerts", "Data & Integrations", "Settings"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("tap targets in the bottom bar are large enough", async ({ page }) => {
    await page.goto("/");
    const links = page.getByRole("navigation", { name: "Main" }).last().getByRole("link");
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("every screen reachable from the shell", () => {
  for (const route of [...NAV_ROUTES, ...EXTRA_ROUTES]) {
    test(`${route.href} loads without a server error`, async ({ page }) => {
      if (await isNotBuilt(page, route.href)) test.skip(true, `${route.href} is not built on this branch yet`);
      await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
});
