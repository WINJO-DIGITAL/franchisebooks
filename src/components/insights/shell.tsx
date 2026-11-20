import Link from "next/link";
import { Badge, Panel } from "@/components/ui/bits";
import type { Tone } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { PLAN_PRICE_GBP } from "@/lib/billing/status";
import type { ScopeStatus } from "@/lib/history/insights";

const TABS = [
  { href: "/insights", label: "Trends" },
  { href: "/insights/drivers", label: "Driver Performance" },
  { href: "/insights/rates", label: "Rate Checks" },
] as const;

export function InsightsTabs({ active }: { active: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Insights" className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === active ? "page" : undefined}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            tab.href === active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Shown in place of a Max feature to accounts on Essential. It names the feature the person was looking at and what Max adds
 * to it, so the upgrade is offered where it is wanted, not on every page.
 */
const MAX_BENEFITS = [
  "The Sliding Scale Report: each route's pay checked against your DPD scale, to the penny, in both directions.",
  "DPD figures for the current and previous tax year, read back from the portal.",
  "Trends, driver performance and rate checks over time.",
];

export function UpgradeToMax({ isOwner, feature = "Insights" }: { isOwner: boolean; feature?: string }) {
  return (
    <Panel className="py-8">
      <p className="text-xs font-semibold uppercase tracking-wider text-accent">Max Plan</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">Unlock {feature} with Max</p>
      <p className="mt-2 max-w-xl text-[0.9375rem] leading-relaxed text-ink-soft">
        Max is £{PLAN_PRICE_GBP.max} a month for your account, however many franchises you run. It adds:
      </p>
      <ul className="mt-4 max-w-xl divide-y divide-line border-y border-line text-[0.9375rem] text-ink-soft">
        {MAX_BENEFITS.map((b) => (
          <li key={b} className="flex gap-3 py-2.5">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {isOwner ? (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href="/settings#plan" className={buttonClass("primary", "md")}>See the Max Plan</Link>
          <span className="text-sm text-muted">Your Essential plan stays as it is until you choose.</span>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">Ask your business owner about moving to Max.</p>
      )}
    </Panel>
  );
}

export const SCOPE_STATUS: Record<ScopeStatus, { label: string; tone: Tone }> = {
  read: { label: "Read", tone: "good" },
  partly_read: { label: "Partly Read", tone: "warn" },
  queued: { label: "Reading", tone: "info" },
  not_listed: { label: "Not on DPD", tone: "neutral" },
  not_read: { label: "Not Read Yet", tone: "neutral" },
};

export function ScopeBadge({ status }: { status: ScopeStatus }) {
  const s = SCOPE_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
