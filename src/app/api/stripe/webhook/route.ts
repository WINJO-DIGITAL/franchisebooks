import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, isOurSubscription, saveSubscription } from "@/lib/billing/stripe";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/notify/email";
import { describeError, logger, reportError } from "@/lib/logger";
import { accountPlan } from "@/lib/billing/plan";
import { startWorkerRun } from "@/lib/github/dispatch";
import { queueHistoryReads } from "@/lib/history/backfill";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Stripe tells us when a subscription starts, changes or ends. The body is signed; anything unsigned or altered is
 * refused. Each event is handled by re-reading the subscription from Stripe, so events arriving out of order cannot
 * leave a stale status behind. A failure answers 500 so Stripe retries.
 */
export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const secret = env.stripeWebhookSecret();
  if (!stripe || !secret) return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    let subscriptionId: string | null = null;
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      subscriptionId = typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
    } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      subscriptionId = (event.data.object as Stripe.Subscription).id;
    }
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      // The Stripe account is shared with other WINJO Digital products, and every webhook endpoint hears about all of their
      // subscriptions. Anything not on a Franchise Books price is acknowledged and left alone, so Stripe does not keep retrying it.
      if (!isOurSubscription(subscription, [env.stripePriceId(), env.stripeMaxPriceId()])) {
        logger.info({ type: event.type, subscription: subscriptionId }, "stripe webhook: not a Franchise Books subscription, ignored");
        return NextResponse.json({ received: true, ignored: true });
      }
      const admin = createAdminClient();
      const userId = await saveSubscription(admin, subscription);
      if (!userId) return NextResponse.json({ received: true, ignored: true });
      await startHistoryOnUpgrade(admin, userId);
      if (subscription.status === "past_due") {
        // Stripe is retrying the card. Tell the paying customer now, so the retry can be fixed in time.
        const { data } = await admin.auth.admin.getUserById(userId);
        if (data.user?.email) {
          await sendEmail({
            to: data.user.email,
            subject: "Your Franchise Books payment did not go through",
            text: "We could not take this month's payment for Franchise Books. Stripe will try again shortly. To keep access, update your card under Settings, then Manage billing.",
          });
        }
      }
      logger.info({ type: event.type, subscription: subscriptionId, status: subscription.status }, "stripe webhook handled");
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    await reportError(error, { where: "stripe.webhook", eventType: event.type });
    return NextResponse.json({ error: "Could not process the event." }, { status: 500 });
  }
}

/**
 * On Max, start reading the account's history straight away rather than waiting for the evening. A person who has paid but not
 * set up their business yet has no franchises, so nothing is queued; the first read after set-up starts it instead.
 */
async function startHistoryOnUpgrade(admin: AdminClient, userId: string): Promise<void> {
  try {
    const { data: profile } = await admin.from("user_profiles").select("account_id").eq("id", userId).eq("role", "owner").maybeSingle();
    if (!profile?.account_id || (await accountPlan(admin, profile.account_id)) !== "max") return;
    if ((await queueHistoryReads(admin, profile.account_id)) > 0) await startWorkerRun();
  } catch (error) {
    // Not fatal: the nightly schedule queues the history for Max accounts anyway.
    logger.warn({ error: describeError(error), userId }, "could not start the Max history read");
  }
}
