import { mkdirSync, writeFileSync } from "node:fs";
import { test as setup, expect } from "@playwright/test";
import { AUTH_DIR, CREDENTIALS_FILE, createTestUser, OWNER_FILE, randomPassword, signInViaForm, uniqueEmail, type Credentials } from "./helpers";

setup("create a signed-in owner for the other tests", async ({ page }) => {
  mkdirSync(AUTH_DIR, { recursive: true });
  const credentials: Credentials = {
    ownerEmail: uniqueEmail("owner"),
    ownerPassword: randomPassword(),
    businessName: `E2E Couriers ${Date.now().toString(36)}`,
  };
  await createTestUser(credentials.ownerEmail, credentials.ownerPassword, credentials.businessName);
  await signInViaForm(page, credentials.ownerEmail, credentials.ownerPassword);
  await expect(page).toHaveURL(/\/$/);
  await page.context().storageState({ path: OWNER_FILE });
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials));
});
