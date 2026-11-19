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

export function getStripe(): Stripe | null {
  const key = env.stripeSecretKey();
  return key ? new Stripe(key) : null;
}

/** Records a Stripe subscription against the user who pays. Safe to repeat: the same subscription gives the same row. */
export async function saveSubscription(db: AdminClient, sub: SubscriptionLike): Promise<string> {
  const row = billingRowFromSubscription(sub, env.stripeMaxPriceId());
  let userId = row.userId;
  if (!userId) {
    const { data } = await db.from("user_billing").select("user_id").eq("stripe_customer_id", row.stripeCustomerId).maybeSingle();
    userId = data?.user_id ?? null;
  }
  if (!userId) throw new Error(`Subscription ${row.stripeSubscriptionId} does not say which user it belongs to.`);
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
  if (error) throw new Error(`Could not record the subscription: ${error.message}`);
  return userId;
}

/** A Stripe Checkout page for the chosen monthly plan. The user's id travels with it so the webhook knows who paid. */
export async function createCheckoutUrl(db: AdminClient, user: { id: string; email: string }, plan: Plan = "standard"): Promise<string> {
  const stripe = getStripe();
  const price = plan === "max" ? env.stripeMaxPriceId() : env.stripePriceId();
  if (!stripe || !price) throw new BillingNotConfigured();
  const { data: existing } = await db.from("user_billing").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
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
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return session.url;
}

/** PostgREST's message when a column the code writes is not in the database yet. */
export function isMissingPlanColumn(message: string): boolean {
  return /\bplan\b/i.test(message) && /(column|schema cache)/i.test(message);
}
