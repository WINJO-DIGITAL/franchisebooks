import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createTestUser, CREDENTIALS_FILE, latestEmailTo, randomPassword, resetLinkFrom, signInViaForm, uniqueEmail, type Credentials } from "./helpers";

// These journeys start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

const credentials = (): Credentials => JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8")) as Credentials;

test.describe("signing in", () => {
  test("the sign-in page is clear and has no accessibility violations", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
  });

  test("a signed-out visitor is sent to sign in, then back to the page they wanted", async ({ page }) => {
    const { ownerEmail, ownerPassword } = credentials();
    await page.goto("/menu");
    await expect(page).toHaveURL(/\/login\?next=%2Fmenu/);
    await page.getByLabel("Email address").fill(ownerEmail);
    await page.getByLabel("Password").fill(ownerPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/menu$/);
  });

  test("a wrong password gets a plain-English message and no technical noise", async ({ page }) => {
    await signInViaForm(page, credentials().ownerEmail, "definitely-not-the-password");
    const alert = page.getByRole("alert").filter({ hasText: "do not match" });
    await expect(alert).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("an empty form says what is missing instead of failing silently", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    // The browser stops an empty required field before the server is asked.
    await expect(page).toHaveURL(/\/login/);
    const email = page.getByLabel("Email address");
    expect(await email.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  });

  test("signing in lands on the dashboard and signing out returns to the sign-in page", async ({ page, isMobile }) => {
    const { ownerEmail, ownerPassword } = credentials();
    await signInViaForm(page, ownerEmail, ownerPassword);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (isMobile) await page.goto("/menu");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    // Signed out, the front page is the sales page (not the dashboard), and a protected page still sends you to sign in.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("what each driver is owed");
    await expect(page.getByRole("link", { name: "Get started" }).first()).toBeVisible();
    await page.goto("/drivers");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("onboarding", () => {
  test("a new user is asked for their business, with helpful messages, then reaches the dashboard", async ({ page }) => {
    const email = uniqueEmail("new");
    const password = randomPassword();
    await createTestUser(email, password); // no business yet
    await signInViaForm(page, email, password);
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // One-character names are rejected with a friendly message.
    await page.getByLabel("What is your business called?").fill("A");
    await page.getByLabel("What is your name?").fill("B");
    await page.getByRole("button", { name: "Connect DPD and set up my dashboard" }).click();
    await expect(page.getByText("Enter your business name.")).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);

    await page.getByLabel("What is your business called?").fill("Onboarding Test Couriers");
    await page.getByLabel("What is your name?").fill("Olive Owner");
    await page.getByLabel("Your first franchise FD number").fill("fd-onb1");
    await page.getByRole("button", { name: "Connect DPD and set up my dashboard" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
  });

  test("someone with a business is not sent back to onboarding", async ({ page }) => {
    const { ownerEmail, ownerPassword } = credentials();
    await signInViaForm(page, ownerEmail, ownerPassword);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/");
    await expect(page).not.toHaveURL(/onboarding/);
  });
});

test.describe("forgotten password", () => {
  test("the owner can ask for a reset link, use it, choose a new password and sign in with it", async ({ page }) => {
    const email = uniqueEmail("reset");
    const oldPassword = randomPassword();
    const newPassword = randomPassword();
    await createTestUser(email, oldPassword, "Reset Test Couriers");

    await page.goto("/login");
    await page.getByRole("button", { name: "Forgotten your password?" }).click();
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByText("a reset link is on its way")).toBeVisible();

    await page.goto(resetLinkFrom(await latestEmailTo(email)));
    await expect(page).toHaveURL(/\/reset-password$/);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

    // Too short, then mismatched, then good.
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("Type it again").fill("short");
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByRole("alert").getByText("Use at least 10 characters.")).toBeVisible();

    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Type it again").fill(`${newPassword}x`);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByRole("alert").getByText("The two passwords do not match.")).toBeVisible();

    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Type it again").fill(newPassword);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page).toHaveURL(/\/$/);

    // The old password no longer works; the new one does.
    await page.context().clearCookies();
    await signInViaForm(page, email, oldPassword);
    await expect(page.getByRole("alert").filter({ hasText: "do not match" })).toBeVisible();
    await signInViaForm(page, email, newPassword);
    await expect(page).toHaveURL(/\/$/);
  });

  test("asking for a reset for an unknown address gives the same answer (no account probing)", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Forgotten your password?" }).click();
    await page.getByLabel("Email address").fill(uniqueEmail("nobody"));
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByText("a reset link is on its way")).toBeVisible();
  });
});
