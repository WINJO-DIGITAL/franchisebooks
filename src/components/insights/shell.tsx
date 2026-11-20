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

/** Shown in place of an Insights page to accounts on the Essential plan. */
export function UpgradeToMax({ isOwner }: { isOwner: boolean }) {
  return (
    <Panel className="py-8 text-center">
      <p className="font-medium text-ink">Insights Are Part of Max</p>
      <div className="mx-auto mt-2 max-w-md space-y-2 text-sm text-ink-soft">
        <p>Max reads your DPD figures back over the current and previous tax year, and shows them as trends, driver performance and rate checks.</p>
        <p>It is £{PLAN_PRICE_GBP.max} a month for your account, however many franchises you have.</p>
      </div>
      {isOwner ? (
        <div className="mt-5 flex justify-center">
          <Link href="/settings" className={buttonClass("primary", "md")}>Change Plan in Settings</Link>
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
