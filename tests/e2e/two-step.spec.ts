import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

/** The 6-digit code an authenticator app shows for a secret (RFC 6238: HMAC-SHA1, 30-second steps). */
function authenticatorCode(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[19]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

test.describe("two-step sign-in", () => {
  const email = `two-step-${Date.now()}@example.test`;
  const password = "two-step-password-123";

  test.beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    await admin.auth.admin.createUser({ email, password, email_confirm: true });
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    await anon.auth.signInWithPassword({ email, password });
    const boot = await anon.rpc("bootstrap_account", { p_business_name: "Two Step Ltd", p_full_name: "Two Step" });
    if (boot.error) throw new Error(boot.error.message);
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
  }

  test("turning it on makes the password alone enough no longer, and turning it off restores it", async ({ browser }) => {
    // Turn it on.
    const first = await (await browser.newContext()).newPage();
    await signIn(first);
    await expect(first).toHaveURL(/\/$/);
    await first.goto("/settings");
    const security = first.locator("#security");
    await security.getByRole("button", { name: "Turn On Two-Step Sign-In" }).click();
    const secret = (await security.locator("span.font-mono").innerText()).trim();
    await security.getByLabel("6-digit code").fill("000000");
    await security.getByRole("button", { name: "Confirm and Turn On" }).click();
    await expect(security.getByText(/not right/i).first()).toBeVisible();
    await security.getByLabel("6-digit code").fill(authenticatorCode(secret));
    await security.getByRole("button", { name: "Confirm and Turn On" }).click();
    await expect(security.getByRole("button", { name: "Turn Off Two-Step Sign-In" })).toBeVisible();

    // A new browser with only the password is stopped at the code page, for pages and for the API.
    const second = await (await browser.newContext()).newPage();
    await signIn(second);
    await expect(second).toHaveURL(/\/login\/verify/);
    await second.goto("/settings");
    await expect(second).toHaveURL(/\/login\/verify/);
    expect((await second.request.get("/api/export/drivers")).status()).toBe(401);

    // A wrong code keeps them there; the right one lets them in.
    await second.goto("/login/verify");
    await second.getByLabel("6-digit code").fill("123456");
    await second.getByRole("button", { name: "Continue" }).click();
    await expect(second.getByText(/not right/i).first()).toBeVisible();
    await second.getByLabel("6-digit code").fill(authenticatorCode(secret));
    await second.getByRole("button", { name: "Continue" }).click();
    await expect(second).toHaveURL(/\/$/);
    await second.goto("/settings");
    await expect(second).toHaveURL(/\/settings/);

    // Turn it off from the session that used a code; the password alone works again.
    await second.locator("#security").getByRole("button", { name: "Turn Off Two-Step Sign-In" }).click();
    await expect(second.locator("#security").getByRole("button", { name: "Turn On Two-Step Sign-In" })).toBeVisible();
    const third = await (await browser.newContext()).newPage();
    await signIn(third);
    await expect(third).toHaveURL(/\/$/);
  });
});
