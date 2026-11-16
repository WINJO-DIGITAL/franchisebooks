import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { EXTRA_ROUTES, isNotBuilt, NAV_ROUTES, OWNER_FILE } from "./helpers";

// WCAG 2.1 AA, on every screen in the main menu plus the extra shell pages.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function summarise(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]): string {
  return violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n   ")}`).join("\n");
}

test.describe("signed in", () => {
  test.use({ storageState: OWNER_FILE });

  for (const route of [...NAV_ROUTES, ...EXTRA_ROUTES]) {
    test(`${route.label} (${route.href}) meets WCAG AA`, async ({ page }) => {
      if (await isNotBuilt(page, route.href)) test.skip(true, `${route.href} is not built on this branch yet`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(results.violations, summarise(results.violations)).toEqual([]);
    });
  }

  test("the not-found page meets WCAG AA", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");
    await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations, summarise(results.violations)).toEqual([]);
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the sign-in page meets WCAG AA, including the reset-link view", async ({ page }) => {
    await page.goto("/login");
    let results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations, summarise(results.violations)).toEqual([]);
    await page.getByRole("button", { name: "Forgotten your password?" }).click();
    results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations, summarise(results.violations)).toEqual([]);
  });

  test("forms can be completed with the keyboard alone", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email address").focus();
    await page.keyboard.type("someone@example.test");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  });
});
