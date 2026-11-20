import { describe, expect, it } from "vitest";
import { billingRowFromSubscription, planFromPriceId, PLAN_PRICE_GBP } from "@/lib/billing/status";

const sub = (priceId: string) => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  metadata: { user_id: "u1" },
  items: { data: [{ current_period_end: 1800000000, price: { id: priceId } }] },
});

describe("billing plans", () => {
  it("prices each plan for display", () => {
    expect(PLAN_PRICE_GBP).toEqual({ standard: 49, max: 99 });
  });

  it("reads the Max plan from the Max price only", () => {
    expect(planFromPriceId("price_max", "price_max")).toBe("max");
    expect(planFromPriceId("price_std", "price_max")).toBe("standard");
  });

  it("falls back to Standard when no Max price is configured", () => {
    expect(planFromPriceId("price_max", null)).toBe("standard");
    expect(planFromPriceId(undefined, "price_max")).toBe("standard");
  });

  it("records the plan on the subscription row", () => {
    expect(billingRowFromSubscription(sub("price_max"), "price_max").plan).toBe("max");
    expect(billingRowFromSubscription(sub("price_std"), "price_max").plan).toBe("standard");
    expect(billingRowFromSubscription(sub("price_std")).plan).toBe("standard");
  });
});

describe("recording a subscription before the plans migration", () => {
  it("recognises the database saying the plan column is missing", async () => {
    const { isMissingPlanColumn } = await import("@/lib/billing/stripe");
    expect(isMissingPlanColumn("Could not find the 'plan' column of 'user_billing' in the schema cache")).toBe(true);
    expect(isMissingPlanColumn('column "plan" of relation "user_billing" does not exist')).toBe(true);
    expect(isMissingPlanColumn("duplicate key value violates unique constraint")).toBe(false);
    expect(isMissingPlanColumn('column "status" does not exist')).toBe(false);
  });
});

describe("subscriptions from other products in the same Stripe account", () => {
  it("records only Franchise Books subscriptions", async () => {
    const { isOurSubscription } = await import("@/lib/billing/stripe");
    const ours = ["price_std", "price_max"];
    expect(isOurSubscription(sub("price_max"), ours)).toBe(true);
    expect(isOurSubscription({ ...sub("price_other"), metadata: {} }, ours)).toBe(false);
    expect(isOurSubscription({ ...sub("price_other"), metadata: { website_subscription_id: "x" } }, ours)).toBe(false);
    // Our checkout always sets the user id, so a subscription on an older price of ours is still recorded.
    expect(isOurSubscription(sub("price_old"), ours)).toBe(true);
    expect(isOurSubscription({ ...sub("price_std"), metadata: {} }, [null, null])).toBe(false);
  });
});
