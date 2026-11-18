import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

/** The sidebar entries, in the order the app shows them. Keep in step with NAV_ITEMS in src/components/shell/nav.tsx. */
export const NAV_ROUTES = [
  { href: "/", label: "Dashboard" },
  { href: "/drivers", label: "Drivers" },
  { href: "/earnings", label: "Income" },
  { href: "/expenses", label: "Expenses" },
  { href: "/adjustments", label: "Adjustments" },
  { href: "/reports", label: "Reports" },
  { href: "/check", label: "Period check" },
  { href: "/data", label: "Data & Integrations" },
  { href: "/settings", label: "Settings" },
] as const;

/** Pages reachable from the shell that are not in the main menu. */
export const EXTRA_ROUTES = [
  { href: "/menu", label: "More" },
  { href: "/alerts", label: "Alerts" },
] as const;

export const AUTH_DIR = "tests/e2e/.auth";
export const OWNER_FILE = `${AUTH_DIR}/owner.json`;
export const CREDENTIALS_FILE = `${AUTH_DIR}/credentials.json`;

export interface Credentials {
  ownerEmail: string;
  ownerPassword: string;
  businessName: string;
}

export function randomPassword(): string {
  return `E2e-${randomBytes(9).toString("base64url")}!`;
}

export function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@example.test`;
}

function localSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) {
    throw new Error("End-to-end tests need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY for a LOCAL Supabase (run `npm run db:start`, then copy the values into .env.local).");
  }
  if (!/127\.0\.0\.1|localhost/.test(new URL(url).hostname)) {
    throw new Error(`End-to-end tests create throw-away users, so they only run against a local database. Refusing to use ${new URL(url).hostname}.`);
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return { admin: createClient(url, serviceKey, options), anon: () => createClient(url, anonKey, options) };
}

/** Creates a confirmed user. With `business`, also creates their business the way onboarding does. */
export async function createTestUser(email: string, password: string, business?: string): Promise<string> {
  const { admin, anon } = localSupabase();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Could not create test user: ${error?.message}`);
  if (business) {
    const client = anon();
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`Could not sign in test user: ${signIn.error.message}`);
    const boot = await client.rpc("bootstrap_account", { p_business_name: business, p_full_name: "E2E Owner" });
    if (boot.error) throw new Error(`Could not create test business: ${boot.error.message}`);
    const accountId = boot.data as string;
    const franchise = await admin.from("franchises").insert({ account_id: accountId, fd_number: `FD-E2E${Date.now().toString(36).toUpperCase().slice(-5)}`, name: "E2E North" });
    if (franchise.error) throw new Error(`Could not create test franchise: ${franchise.error.message}`);
  }
  return data.user.id;
}

export async function deleteTestUser(userId: string): Promise<void> {
  // Users with a business cannot be removed (financial records are kept), so this only tidies the empty ones.
  await localSupabase().admin.auth.admin.deleteUser(userId).catch(() => undefined);
}

/** Signs in through the real form. */
export async function signInViaForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Finds the most recent email sent to an address in the local Mailpit inbox that Supabase starts. */
export async function latestEmailTo(address: string, timeoutMs = 20_000): Promise<{ html: string; text: string }> {
  const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=1`).catch(() => null);
    if (search?.ok) {
      const { messages } = (await search.json()) as { messages?: { ID: string }[] };
      const id = messages?.[0]?.ID;
      if (id) {
        const message = (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as { HTML: string; Text: string };
        return { html: message.HTML, text: message.Text };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email arrived for ${address}. Is the local Supabase mail catcher running on ${mailpit}?`);
}

/** The first link in an email that points at the auth verify endpoint. */
export function resetLinkFrom(email: { html: string; text: string }): string {
  const source = `${email.html}\n${email.text}`;
  const match = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]*/.exec(source);
  if (!match) throw new Error("The reset email did not contain a link.");
  return match[0].replace(/&amp;/g, "&");
}

export async function expectNoErrorScreen(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
}

/** Opens a screen and fails (rather than skips) if it is missing or errors. */
export async function openScreen(page: Page, href: string): Promise<void> {
  const response = await page.goto(href);
  expect(response?.status(), `${href} should load`).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: "We could not find that page" })).toHaveCount(0);
}
