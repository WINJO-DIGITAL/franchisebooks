import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConfirmingPayment } from "@/components/billing/confirming-payment";
import { PaymentConfirmed } from "@/components/billing/payment-confirmed";
import { SubscribeForm } from "@/components/billing/forms";
import { Notice } from "@/components/ui/bits";
import { subscribeAudience } from "@/lib/billing/audience";
import { PLAN_NAME, PLAN_PRICE_GBP } from "@/lib/billing/status";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Subscribe" };

export default async function SubscribePage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  // Already paid (or comped): carry on to set-up, or into the app if the business exists.
  const { data: allowed } = await supabase.rpc("billing_allows_access");
  if (allowed) {
    const { data: profile } = await supabase.from("user_profiles").select("id").eq("id", data.user.id).maybeSingle();
    const nextHref = profile ? "/" : "/onboarding";
    // Just back from Stripe: show the confirmation first, then move on.
    if (params.checkout === "done") return <PaymentConfirmed nextHref={nextHref} />;
    redirect(nextHref);
  }

  // Drivers never pay, and managers or viewers are covered by their business owner's subscription.
  const audience = await subscribeAudience(supabase, data.user.id);
  if (audience === "driver") redirect("/my");
  if (audience === "member") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Your Subscription Is Managed by the Owner</h1>
        <p className="mt-2 text-sm text-muted">Your business&apos;s subscription is paid by its owner, so there is nothing for you to pay. If you cannot get in, please ask the owner to check their billing.</p>
      </>
    );
  }

  const configured = Boolean(env.stripeSecretKey() && env.stripePriceId());
  const maxConfigured = Boolean(env.stripeSecretKey() && env.stripeMaxPriceId());
  const justPaid = params.checkout === "done";

  if (justPaid) return <ConfirmingPayment />;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose Your Plan</h1>
      <p className="mt-2 text-sm text-muted">Your DPD earnings, expenses and driver pay, worked out for you every day. Every franchise on your account is included in either plan.</p>
      {params.checkout === "cancelled" ? <div className="mt-4"><Notice tone="warn" title="Payment Was Not Completed" detail="No charge was made. You can try again whenever you are ready." /></div> : null}

      <section className="mt-6 rounded-xl border border-line p-4">
        <p className="text-sm font-semibold text-ink">{PLAN_NAME.standard}</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight">£{PLAN_PRICE_GBP.standard}<span className="text-base font-normal text-muted"> a month</span></p>
        <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
          <li>Syncs with the DPD portal every night</li>
          <li>Driver pay, expenses and a period report, ready for payday</li>
          <li>Cancel any time</li>
        </ul>
        {configured ? <div className="mt-4"><SubscribeForm plan="standard" price={PLAN_PRICE_GBP.standard} /></div> : <div className="mt-4"><Notice tone="warn" title="Payments Are Not Switched on Yet" detail="Please check back shortly." /></div>}
      </section>

      {maxConfigured ? (
        <section className="mt-4 rounded-xl border border-line p-4">
          <p className="text-sm font-semibold text-ink">Max</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">£{PLAN_PRICE_GBP.max}<span className="text-base font-normal text-muted"> a month</span></p>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
            <li>Everything in {PLAN_NAME.standard}</li>
            <li>Your DPD figures back over the current and previous tax year</li>
            <li>Long-run trends, driver performance and rate checks</li>
          </ul>
          <div className="mt-4"><SubscribeForm plan="max" price={PLAN_PRICE_GBP.max} /></div>
        </section>
      ) : null}
    </>
  );
}
