import { afterEach, describe, expect, it } from "vitest";
import { env } from "@/lib/env";

const KEYS = ["STRIPE_MODE", "STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_LIVE", "STRIPE_PRICE_ID", "STRIPE_PRICE_ID_LIVE", "STRIPE_MAX_PRICE_ID", "STRIPE_MAX_PRICE_ID_LIVE", "STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_LIVE", "STRIPE_PORTAL_CONFIGURATION_ID", "STRIPE_PORTAL_CONFIGURATION_ID_LIVE"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

function set(values: Record<string, string>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, values);
}

describe("Stripe mode", () => {
  const both = {
    STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_ID: "price_test_std", STRIPE_MAX_PRICE_ID: "price_test_max", STRIPE_WEBHOOK_SECRET: "whsec_test", STRIPE_PORTAL_CONFIGURATION_ID: "bpc_test",
    STRIPE_SECRET_KEY_LIVE: "sk_live_x", STRIPE_PRICE_ID_LIVE: "price_live_std", STRIPE_MAX_PRICE_ID_LIVE: "price_live_max", STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live", STRIPE_PORTAL_CONFIGURATION_ID_LIVE: "bpc_live",
  };

  it("uses the test settings unless STRIPE_MODE is live", () => {
    set(both);
    expect(env.stripeLive()).toBe(false);
    expect([env.stripeSecretKey(), env.stripePriceId(), env.stripeMaxPriceId(), env.stripeWebhookSecret(), env.stripePortalConfigurationId()])
      .toEqual(["sk_test_x", "price_test_std", "price_test_max", "whsec_test", "bpc_test"]);
  });

  it("uses only the live settings in live mode", () => {
    set({ ...both, STRIPE_MODE: "live" });
    expect(env.stripeLive()).toBe(true);
    expect([env.stripeSecretKey(), env.stripePriceId(), env.stripeMaxPriceId(), env.stripeWebhookSecret(), env.stripePortalConfigurationId()])
      .toEqual(["sk_live_x", "price_live_std", "price_live_max", "whsec_live", "bpc_live"]);
  });

  it("never falls back to a test value in live mode, so billing reads as not set up instead of mixing modes", () => {
    set({ STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_ID: "price_test_std" });
    expect(env.stripeSecretKey()).toBeNull();
    expect(env.stripePriceId()).toBeNull();
  });
});
