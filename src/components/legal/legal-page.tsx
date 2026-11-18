import Link from "next/link";
import type { ReactNode } from "react";

/** Shared frame for the legal pages. Every page is a draft until a solicitor has reviewed it. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <Link href="/welcome" className="text-sm text-accent underline-offset-2 hover:underline">Franchise Books by Winjo Digital</Link>
      <div className="mt-4 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">Draft. This page must be reviewed by a solicitor before it is published.</div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted">Last updated {updated}</p>
      <div className="mt-8 space-y-4 text-[0.9375rem] leading-relaxed text-ink-soft [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">{children}</div>
    </div>
  );
}
