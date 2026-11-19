"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";

const CONTINUE_AFTER_MS = 6000;

/**
 * Shown once the payment is recorded. Confirms the plan is active, then moves on to set-up by itself,
 * or straight away when the person chooses to continue.
 */
export function PaymentConfirmed({ nextHref }: { nextHref: string }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => router.replace(nextHref), CONTINUE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [router, nextHref]);

  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center py-4 text-center">
      <div className="relative grid size-20 place-items-center" aria-hidden>
        <span className="absolute inset-0 animate-[pop_0.6s_ease-out_both] rounded-full bg-good/15" />
        <svg viewBox="0 0 48 48" className="relative size-12 text-good" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="24" cy="24" r="21" className="opacity-25" />
          <path d="M14 25 L21 32 L34 17" pathLength="1" className="[stroke-dasharray:1] [stroke-dashoffset:1] animate-[draw-check_0.6s_0.25s_ease-out_forwards]" />
        </svg>
      </div>

      <h1 className="mt-6 text-xl font-semibold tracking-tight text-ink">Payment Confirmed</h1>
      <p className="mt-2 max-w-xs text-sm text-ink-soft">Your Franchise Books plan is active. Next, tell us about your business and connect your DPD login.</p>

      <Link href={nextHref} className={`${buttonClass("primary", "md")} mt-8 w-full`}>Continue to Set Up</Link>
      <p className="mt-3 text-xs text-muted">Taking you there in a moment.</p>
    </div>
  );
}
