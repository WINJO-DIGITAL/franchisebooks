"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";

const CHECK_EVERY_MS = 3000;
const SLOW_AFTER_SECONDS = 45;
/** What happens on the server, in order. Shown as activity, never as a tick: nothing is confirmed until the server says so. */
const STEPS = ["Receiving your payment", "Setting up your plan", "Opening your account"];

/**
 * Shown after Stripe sends the person back. Re-reads the server every few seconds until the webhook has recorded the
 * subscription, then the page moves on by itself. If it takes too long, it says so and offers a way forward.
 */
export function ConfirmingPayment() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const check = setInterval(() => router.refresh(), CHECK_EVERY_MS);
    const clock = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      clearInterval(check);
      clearInterval(clock);
    };
  }, [router]);

  const step = STEPS[Math.min(STEPS.length - 1, Math.floor(seconds / 4))];
  const slow = seconds >= SLOW_AFTER_SECONDS;

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center py-6 text-center">
      <div className="relative grid size-20 place-items-center" aria-hidden>
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
        <span className="absolute inset-2 rounded-full bg-accent/15" />
        <span className="relative size-9 animate-spin rounded-full border-[3px] border-line border-t-accent" />
      </div>

      <h1 className="mt-6 text-xl font-semibold tracking-tight text-ink">Confirming Your Payment</h1>
      <p className="mt-2 max-w-xs text-sm text-ink-soft">Thank you. This takes a few seconds, and the page moves on by itself.</p>

      <p className="mt-6 text-sm font-medium text-ink" aria-live="polite">{step}…</p>
      <div className="mt-3 h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className="h-full w-1/3 animate-[shimmer_1.6s_ease-in-out_infinite] rounded-full bg-accent" />
      </div>

      {slow ? (
        <div className="mt-8 w-full rounded-[var(--radius-card)] border border-line bg-sunken px-4 py-3 text-left text-sm">
          <p className="text-ink">This is taking longer than usual.</p>
          <p className="mt-1 text-ink-soft">Your payment is safe, and nothing more is needed from you. Give it another minute, or check again now.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => router.refresh()} className={buttonClass("primary", "sm")}>Check Again</button>
            <Link href="/subscribe" className={buttonClass("secondary", "sm")}>Back to Plans</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
