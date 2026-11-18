import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AutoRefresh, SubscribeForm } from "@/components/billing/forms";
import { Notice } from "@/components/ui/bits";
import { PLAN_PRICE_GBP } from "@/lib/billing/status";
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
    redirect(profile ? "/" : "/onboarding");
  }

  const configured = Boolean(env.stripeSecretKey() && env.stripePriceId());
  const justPaid = params.checkout === "done";

  return (
    <>
      <h1 className="text-xl font-semibold">{justPaid ? "Confirming your payment" : "Start your subscription"}</h1>
      {justPaid ? (
        <>
          <p className="mt-2 text-sm text-muted">Thank you. This takes a few seconds, and the page moves on by itself.</p>
          <AutoRefresh />
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">One plan, one price. Your DPD earnings, expenses and driver pay, worked out for you every day.</p>
          <p className="mt-5 text-3xl font-semibold tracking-tight">£{PLAN_PRICE_GBP}<span className="text-base font-normal text-muted"> a month</span></p>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
            <li>Every franchise on your account included</li>
            <li>Syncs with the DPD portal every night</li>
            <li>Driver pay, expenses and a period report, ready for payday</li>
            <li>Cancel any time</li>
          </ul>
          {params.checkout === "cancelled" ? <div className="mt-4"><Notice tone="warn" title="Payment was not completed" detail="No charge was made. You can try again whenever you are ready." /></div> : null}
          {configured ? <SubscribeForm price={PLAN_PRICE_GBP} /> : <div className="mt-6"><Notice tone="warn" title="Payments are not switched on yet" detail="Please check back shortly." /></div>}
        </>
      )}
    </>
  );
}
