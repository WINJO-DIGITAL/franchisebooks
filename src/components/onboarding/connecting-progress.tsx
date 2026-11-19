"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { retryFirstSync } from "@/lib/actions/onboarding";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";

interface Progress {
  phase: "working" | "done" | "needs_attention";
  total: number;
  finished: number;
  succeeded: number;
  message: string | null;
}

/** What the read does, in the order it does it. Shown as activity, never as a tick, until the read has actually finished. */
const ACTIVITY = ["Signing in to DPD", "Reading your payments", "Reading your charges", "Reading your invoices"];
const SLOW_AFTER_SECONDS = 480;

export function ConnectingProgress() {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [seconds, setSeconds] = useState(0);
  const redirected = useRef(false);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/onboarding/progress", { cache: "no-store" });
        if (res.ok && !stopped) setProgress((await res.json()) as Progress);
      } catch {
        /* a missed poll is fine; the next one tries again */
      }
    };
    void poll();
    const pollTimer = setInterval(poll, 2500);
    const clock = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    if (progress?.phase === "done" && !redirected.current) {
      redirected.current = true;
      const t = setTimeout(() => router.replace("/"), 1800);
      return () => clearTimeout(t);
    }
  }, [progress, router]);

  const phase = progress?.phase ?? "working";
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.round(((progress?.finished ?? 0) / total) * 100) : 4;

  if (phase === "needs_attention") {
    return (
      <div role="alert">
        <h1 className="text-xl font-semibold">We Could Not Read Your DPD Account</h1>
        <p className="mt-2 text-sm text-ink-soft">{progress?.message}</p>
        <ActionForm action={retryFirstSync} className="mt-6 space-y-3">
          <SubmitButton className="w-full" pendingLabel="Trying Again…">Try Again</SubmitButton>
        </ActionForm>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Link href="/settings" className={`${buttonClass("secondary", "md")} flex-1`}>Check my DPD login</Link>
          <Link href="/" className={`${buttonClass("quiet", "md")} flex-1`}>Go to my dashboard</Link>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div role="status">
        <h1 className="text-xl font-semibold">You Are All Set</h1>
        <p className="mt-2 text-sm text-ink-soft">We have read your DPD account. Taking you to your dashboard…</p>
        <ul className="mt-5 space-y-2 text-sm">
          {["Payments read", "Charges read", "Invoices read", "Driver pay worked out"].map((t) => (
            <li key={t} className="flex items-center gap-2"><span aria-hidden className="grid size-5 place-items-center rounded-full bg-good text-xs text-white">✓</span>{t}</li>
          ))}
        </ul>
        {progress?.message ? <p className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">{progress.message}</p> : null}
        <Link href="/" className={`${buttonClass("primary", "md")} mt-6 w-full`}>Go to my dashboard now</Link>
      </div>
    );
  }

  const activity = ACTIVITY[Math.min(ACTIVITY.length - 1, Math.floor(seconds / 6)) % ACTIVITY.length];
  return (
    <div role="status" aria-live="polite">
      <h1 className="text-xl font-semibold">Reading Your DPD Account</h1>
      <p className="mt-2 text-sm text-ink-soft">This takes a few minutes. You can leave this page open; it moves on by itself.</p>
      <div className="mt-6 flex items-center gap-3">
        <span aria-hidden className="size-5 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />
        <p className="text-sm font-medium">{activity}…</p>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${Math.max(4, pct)}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">{total > 0 ? `${progress?.finished ?? 0} of ${total} franchise${total === 1 ? "" : "s"} read` : "Getting started…"}</p>
      {seconds > SLOW_AFTER_SECONDS ? (
        <div className="mt-6 rounded-lg border border-line bg-sunken px-4 py-3 text-sm">
          <p>This is taking longer than usual. It carries on in the background, and your dashboard fills in as it goes.</p>
          <Link href="/" className={`${buttonClass("secondary", "sm")} mt-3`}>Go to my dashboard</Link>
        </div>
      ) : null}
    </div>
  );
}
