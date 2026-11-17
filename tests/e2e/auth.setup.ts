import { expect, test as setup } from "@playwright/test";

setup("sign in as the demo owner", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("demo@example.test");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.context().storageState({ path: "tests/e2e/.auth/owner.json" });
});
