/**
 * Subscription status rules. Pure code: no database, no network, no Stripe SDK.
 */

export type BillingStatus = "incomplete" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused" | "comped";

/** The price, for display only; the amount charged is the Stripe price set in STRIPE_PRICE_ID. */
export const PLAN_PRICE_GBP = 49;

/** Statuses that let a person use the app. past_due is included: Stripe is still retrying the card. */
const ACCESS: ReadonlySet<string> = new Set(["active", "trialing", "past_due", "comped"]);

export function statusGrantsAccess(status: string | null | undefined): boolean {
  return status != null && ACCESS.has(status);
}

const KNOWN: ReadonlySet<string> = new Set(["incomplete", "trialing", "active", "past_due", "canceled", "unpaid", "paused", "comped"]);

/** Stripe has a few statuses of its own (incomplete_expired); map anything we do not store to the nearest of ours. */
export function normaliseStatus(stripeStatus: string): BillingStatus {
  if (KNOWN.has(stripeStatus)) return stripeStatus as BillingStatus;
  if (stripeStatus === "incomplete_expired") return "canceled";
  return "incomplete";
}

/** The Stripe subscription fields we read (loosely typed so the SDK's version changes cannot break us). */
export interface SubscriptionLike {
  id: string;
  status: string;
  customer: string | { id: string };
  metadata?: Record<string, string> | null;
  cancel_at_period_end?: boolean;
  /** Older API versions put this on the subscription... */
  current_period_end?: number;
  /** ...newer ones on each item. */
  items?: { data: { current_period_end?: number }[] };
}

export interface BillingRow {
  /** The user who paid, when the subscription says so (set when checkout is created). */
  userId: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: BillingStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export function billingRowFromSubscription(sub: SubscriptionLike): BillingRow {
  const end = sub.current_period_end ?? sub.items?.data[0]?.current_period_end ?? null;
  return {
    userId: sub.metadata?.user_id || null,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    status: normaliseStatus(sub.status),
    currentPeriodEnd: end == null ? null : new Date(end * 1000).toISOString(),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
}
