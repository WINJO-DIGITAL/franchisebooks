import { describe, expect, it } from "vitest";
import { billingRowFromSubscription, normaliseStatus, statusGrantsAccess } from "@/lib/billing/status";

describe("billing access", () => {
  it("grants access while paid, trialling, in a payment retry, or comped", () => {
    for (const s of ["active", "trialing", "past_due", "comped"]) expect(statusGrantsAccess(s)).toBe(true);
  });

  it("refuses access for anything else, including no subscription", () => {
    for (const s of ["incomplete", "canceled", "unpaid", "paused", "nonsense", "", null, undefined]) expect(statusGrantsAccess(s)).toBe(false);
  });

  it("maps Stripe's own extra status to one we store", () => {
    expect(normaliseStatus("incomplete_expired")).toBe("canceled");
    expect(normaliseStatus("something_new")).toBe("incomplete");
    expect(normaliseStatus("active")).toBe("active");
  });
});

describe("reading a Stripe subscription", () => {
  it("takes the paying user from the checkout metadata and the period end from the subscription", () => {
    const row = billingRowFromSubscription({ id: "sub_1", status: "active", customer: "cus_1", metadata: { user_id: "u1" }, current_period_end: 1_800_000_000 });
    expect(row).toEqual({ userId: "u1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "active", currentPeriodEnd: new Date(1_800_000_000 * 1000).toISOString(), cancelAtPeriodEnd: false });
  });

  it("reads the period end from the item on newer Stripe versions, and an expanded customer", () => {
    const row = billingRowFromSubscription({ id: "sub_2", status: "past_due", customer: { id: "cus_2" }, cancel_at_period_end: true, items: { data: [{ current_period_end: 1_800_100_000 }] } });
    expect(row.stripeCustomerId).toBe("cus_2");
    expect(row.currentPeriodEnd).toBe(new Date(1_800_100_000 * 1000).toISOString());
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(row.userId).toBeNull();
  });
});
