"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Compass, RotateCcw } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

interface ErrorViewProps {
  /** The error Next.js caught. In production only the `digest` is available. */
  error: Error & { digest?: string };
  /** Try the same page again. */
  reset: () => void;
  /** Where "Go to the dashboard" should lead. Pass null to hide it (e.g. when the dashboard itself failed). */
  homeHref?: string | null;
  /** Full-page layout (used outside the signed-in shell). */
  standalone?: boolean;
}

/**
 * Plain-English "something went wrong" screen. Technical information is kept
 * inside an expandable section so the owner is never faced with a stack trace
 * but a developer can still copy what they need.
 */
export function ErrorView({ error, reset, homeHref = "/", standalone = false }: ErrorViewProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Next.js logs server errors itself; this keeps a trace in the browser console for support.
    console.error(error);
  }, [error]);

  const technical = [
    `Time: ${new Date().toISOString()}`,
    typeof window !== "undefined" ? `Page: ${window.location.pathname}` : null,
    error.digest ? `Reference: ${error.digest}` : null,
    error.name ? `Type: ${error.name}` : null,
    error.message ? `Message: ${error.message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(technical);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={cn("flex items-center justify-center px-4", standalone ? "min-h-dvh py-10" : "py-16")}>
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 sm:p-8" role="alert">
        <span className="grid size-10 place-items-center rounded-lg bg-warn-soft text-warn" aria-hidden>
          <AlertTriangle className="size-5" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-soft">
          We could not show this page. Nothing you have saved has been lost or changed. Trying again often fixes it.
        </p>
        <p className="mt-2 text-sm text-muted">If it keeps happening, tell whoever looks after the system and give them the details below.</p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={reset} className={buttonClass("primary")}>
            <RotateCcw className="size-4" aria-hidden />
            Try again
          </button>
          {homeHref ? (
            <Link href={homeHref} className={buttonClass("secondary")}>
              Go to the dashboard
            </Link>
          ) : null}
        </div>

        <details className="mt-6 text-sm text-ink-soft">
          <summary className="cursor-pointer select-none text-muted">Technical details</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-sunken p-3 font-mono text-xs">{technical}</pre>
          <button type="button" onClick={copy} className={buttonClass("quiet", "sm", "mt-2")}>
            {copied ? "Copied" : "Copy details"}
          </button>
        </details>
      </div>
    </div>
  );
}

export function NotFoundView({ homeHref = "/" }: { homeHref?: string }) {
  return (
    <div className="flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 sm:p-8">
        <span className="grid size-10 place-items-center rounded-lg bg-info-soft text-info" aria-hidden>
          <Compass className="size-5" />
        </span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">We could not find that page</h1>
        <p className="mt-2 text-[0.9375rem] text-ink-soft">
          The link may be out of date, or the page may have moved. Nothing has been lost.
        </p>
        <div className="mt-6">
          <Link href={homeHref} className={buttonClass("primary")}>
            Go to the dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
