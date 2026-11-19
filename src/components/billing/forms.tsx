"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { openBillingPortal, startCheckout } from "@/lib/actions/billing";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";

export function SubscribeForm({ plan, price }: { plan: "standard" | "max"; price: number }) {
  return (
    <ActionForm action={startCheckout}>
      <input type="hidden" name="plan" value={plan} />
      <SubmitButton className="w-full" variant={plan === "max" ? "secondary" : "primary"} pendingLabel="Opening the Payment Page…">
        Subscribe for £{price} a month
      </SubmitButton>
    </ActionForm>
  );
}

export function ManageBillingForm() {
  return (
    <ActionForm action={openBillingPortal}>
      <SubmitButton variant="secondary" size="sm" pendingLabel="Opening…">Manage Billing</SubmitButton>
    </ActionForm>
  );
}

/** After paying, Stripe tells us a moment later. Re-check every few seconds until the page can move on. */
export function AutoRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
