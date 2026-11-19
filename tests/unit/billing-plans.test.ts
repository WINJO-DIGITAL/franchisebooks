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
