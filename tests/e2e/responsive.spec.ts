import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { EXTRA_ROUTES, NAV_ROUTES, openScreen, OWNER_FILE } from "./helpers";

// Small phone, ordinary phone, laptop. Screenshots are kept as CI artefacts for the polish pass.
const WIDTHS = [320, 390, 1280] as const;
const SCREENSHOT_DIR = "test-results/screenshots";

test.use({ storageState: OWNER_FILE });

// The projects only differ by default size; each test sets its own width, so run them once.
test.beforeEach(({ isMobile }) => test.skip(isMobile, "Widths are set explicitly; run once on the desktop project."));

for (const width of WIDTHS) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: width >= 1000 ? 800 : 800 } });

    for (const route of [...NAV_ROUTES, ...EXTRA_ROUTES]) {
      test(`${route.label} fits the screen`, async ({ page }) => {
        await openScreen(page, route.href);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        // Nothing may force the whole page to scroll sideways (wide tables scroll inside their own box).
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `page is ${overflow}px wider than the screen`).toBeLessThanOrEqual(1);

        // Text must stay a readable size on a phone.
        const bodySize = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
        expect(bodySize).toBeGreaterThanOrEqual(14);

        mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const name = route.href === "/" ? "dashboard" : route.href.slice(1);
        await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-${width}.png`, fullPage: true });
      });
    }
  });
}

test("the sign-in page fits a 320px screen", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  await page.goto("/login");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/login-320.png`, fullPage: true });
  await context.close();
});
