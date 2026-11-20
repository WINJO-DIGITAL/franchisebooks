"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { openBillingPortal, startCheckout } from "@/lib/actions/billing";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";

export function SubscribeForm({ plan, price, label }: { plan: "standard" | "max"; price: number; label?: string }) {
  return (
    <ActionForm action={startCheckout}>
      <input type="hidden" name="plan" value={plan} />
      <SubmitButton className="w-full" variant={plan === "max" ? "secondary" : "primary"} pendingLabel="Opening the Payment Page…">
        {label ?? `Subscribe for £${price} a month`}
      </SubmitButton>
    </ActionForm>
  );
}

/** Opens the Stripe billing portal, where the owner can change plan, update the card or cancel. */
export function ManageBillingForm({ label = "Manage Billing", variant = "secondary" }: { label?: string; variant?: "primary" | "secondary" } = {}) {
  return (
    <ActionForm action={openBillingPortal}>
      <SubmitButton variant={variant} size="sm" pendingLabel="Opening…">{label}</SubmitButton>
    </ActionForm>
  );
}

/**
 * Upgrade from Essential to Max. An account that already has a subscription changes plan in the billing portal (Stripe
 * prorates it). An account with no subscription starts a Max checkout.
 */
export function UpgradeToMaxButton({ hasSubscription, price }: { hasSubscription: boolean; price: number }) {
  if (hasSubscription) return <ManageBillingForm label="Upgrade to Max" variant="primary" />;
  return <SubscribeForm plan="max" price={price} label={`Upgrade to Max, £${price} a month`} />;
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
