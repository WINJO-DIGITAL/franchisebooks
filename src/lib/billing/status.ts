/**
 * Subscription status rules. Pure code: no database, no network, no Stripe SDK.
 */

export type BillingStatus = "incomplete" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused" | "comped";

/**
 * The plans. The amount charged is the Stripe price set in STRIPE_PRICE_ID (Essential) or STRIPE_MAX_PRICE_ID (Max).
 * The stored value for Essential stays "standard" (it is in the database); only the name people see is Essential.
 */
export const PLANS = ["standard", "max"] as const;
export type Plan = (typeof PLANS)[number];

/** The name each plan is shown under. */
export const PLAN_NAME: Record<Plan, string> = { standard: "Essential", max: "Max" };

/** Prices shown to people, for display only. */
export const PLAN_PRICE_GBP: Record<Plan, number> = { standard: 49, max: 99 };

export function planFromPriceId(priceId: string | null | undefined, maxPriceId: string | null | undefined): Plan {
  return priceId && maxPriceId && priceId === maxPriceId ? "max" : "standard";
}

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
  items?: { data: { current_period_end?: number; price?: { id: string } }[] };
}

export interface BillingRow {
  /** The user who paid, when the subscription says so (set when checkout is created). */
  userId: string | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: BillingStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  plan: Plan;
}

export function billingRowFromSubscription(sub: SubscriptionLike, maxPriceId?: string | null): BillingRow {
  const end = sub.current_period_end ?? sub.items?.data[0]?.current_period_end ?? null;
  return {
    userId: sub.metadata?.user_id || null,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    status: normaliseStatus(sub.status),
    currentPeriodEnd: end == null ? null : new Date(end * 1000).toISOString(),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    plan: planFromPriceId(sub.items?.data[0]?.price?.id, maxPriceId),
  };
}
