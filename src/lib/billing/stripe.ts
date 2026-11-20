import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { AdminClient } from "@/lib/supabase/admin";
import { billingRowFromSubscription, type Plan, type SubscriptionLike } from "./status";

export class BillingNotConfigured extends Error {
  constructor() {
    super("Billing is not set up yet.");
  }
}

/** The person already has a Franchise Books subscription, so a new checkout would charge them twice. */
export class AlreadySubscribed extends Error {
  constructor() {
    super("There is already a subscription on this login.");
  }
}

export function getStripe(): Stripe | null {
  const key = env.stripeSecretKey();
  return key ? new Stripe(key) : null;
}

/**
 * Records a Stripe subscription against the user who pays. Safe to repeat: the same subscription gives the same row.
 * Returns null when there is nobody to record it against (the login was deleted): retrying would never succeed, so the
 * caller acknowledges it instead of making Stripe retry for days.
 */
export async function saveSubscription(db: AdminClient, sub: SubscriptionLike): Promise<string | null> {
  const row = billingRowFromSubscription(sub, env.stripeMaxPriceId());
  let userId = row.userId;
  if (!userId) {
    const { data } = await db.from("user_billing").select("user_id").eq("stripe_customer_id", row.stripeCustomerId).maybeSingle();
    userId = data?.user_id ?? null;
  }
  if (!userId) {
    logger.warn({ subscription: row.stripeSubscriptionId }, "subscription does not say which user it belongs to; not recorded");
    return null;
  }
  const base = {
    user_id: userId,
    stripe_customer_id: row.stripeCustomerId,
    stripe_subscription_id: row.stripeSubscriptionId,
    status: row.status,
    current_period_end: row.currentPeriodEnd,
    cancel_at_period_end: row.cancelAtPeriodEnd,
  };
  let { error } = await db.from("user_billing").upsert({ ...base, plan: row.plan }, { onConflict: "user_id" });
  if (error && isMissingPlanColumn(error.message)) {
    // The plans migration has not been applied yet: still record the subscription, so paying customers get in. Max is only
    // offered once STRIPE_MAX_PRICE_ID is set, which comes after the migration (docs/BILLING.md).
    if (row.plan === "max") logger.error({ subscription: row.stripeSubscriptionId }, "a Max subscription was recorded without its plan: apply the plans migration");
    ({ error } = await db.from("user_billing").upsert(base, { onConflict: "user_id" }));
  }
  if (error && isMissingUser(error.message)) {
    logger.warn({ subscription: row.stripeSubscriptionId, userId }, "subscription belongs to a login that no longer exists; not recorded (cancel it in Stripe)");
    return null;
  }
  if (error) throw new Error(`Could not record the subscription: ${error.message}`);
  return userId;
}

/** A Stripe Checkout page for the chosen monthly plan. The user's id travels with it so the webhook knows who paid. */
export async function createCheckoutUrl(db: AdminClient, user: { id: string; email: string }, plan: Plan = "standard"): Promise<string> {
  const stripe = getStripe();
  const price = plan === "max" ? env.stripeMaxPriceId() : env.stripePriceId();
  if (!stripe || !price) throw new BillingNotConfigured();
  const { data: existing } = await db.from("user_billing").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  // Never a second subscription: if the webhook is slow and the person tries again, or comes back later, they are already paying.
  // Our checkout puts the user's id on every subscription, so Stripe is asked directly rather than waiting for the webhook.
  const ours = [env.stripePriceId(), env.stripeMaxPriceId()];
  const found = await stripe.subscriptions.search({ query: `metadata['user_id']:'${user.id}'`, limit: 10 });
  const fromCustomer = existing?.stripe_customer_id
    ? (await stripe.subscriptions.list({ customer: existing.stripe_customer_id, status: "all", limit: 10 })).data
    : [];
  if ([...found.data, ...fromCustomer].some((s) => hasLiveStatus(s.status) && isOurSubscription(s, ours))) throw new AlreadySubscribed();
  const base = env.appUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: user.id,
    ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : { customer_email: user.email }),
    subscription_data: { metadata: { user_id: user.id } },
    metadata: { user_id: user.id, plan },
    allow_promotion_codes: true,
    success_url: `${base}/subscribe?checkout=done`,
    cancel_url: `${base}/subscribe?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout address.");
  return session.url;
}

/** Stripe's page where a customer changes their card or cancels. */
export async function createPortalUrl(customerId: string, returnUrl: string): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new BillingNotConfigured();
  const configuration = env.stripePortalConfigurationId();
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl, ...(configuration ? { configuration } : {}) });
  return session.url;
}

/** PostgREST's message when a column the code writes is not in the database yet. */
export function isMissingPlanColumn(message: string): boolean {
  return /\bplan\b/i.test(message) && /(column|schema cache)/i.test(message);
}

/**
 * True when a subscription is for Franchise Books: one of its items is on one of our prices, or it carries the user id our
 * checkout puts on it. Other products in the same Stripe account are not ours to record.
 */
export function isOurSubscription(sub: SubscriptionLike, ourPriceIds: (string | null)[]): boolean {
  const prices = new Set(ourPriceIds.filter((p): p is string => Boolean(p)));
  if (sub.items?.data.some((item) => item.price?.id && prices.has(item.price.id))) return true;
  return Boolean(sub.metadata?.user_id);
}

/** A subscription in one of these states is still being paid for (or about to be), so another must not be started. */
export function hasLiveStatus(status: string): boolean {
  return ["active", "trialing", "past_due", "incomplete", "unpaid"].includes(status);
}

/** The database's answer when the paying user's login has been deleted. */
export function isMissingUser(message: string): boolean {
  return /user_billing_user_id_fkey|violates foreign key constraint/i.test(message);
}

/**
 * Stops a subscription renewing: it runs to the end of the period already paid for, then ends. Returns false when it could
 * not be done (billing not set up, or Stripe refused), so the caller can tell the person how to cancel it themselves.
 */
export async function cancelAtPeriodEnd(subscriptionId: string): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe) return false;
  try {
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    return true;
  } catch (error) {
    logger.warn({ subscriptionId, error: error instanceof Error ? error.message : String(error) }, "could not cancel the subscription at period end");
    return false;
  }
}
