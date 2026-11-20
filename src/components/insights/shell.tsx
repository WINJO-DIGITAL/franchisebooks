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

/** Example figures for the Max prompt. Illustrative only: they are labelled as such and make no claim about any real franchise. */
const EXAMPLE_ROUTES = [
  { route: "Route R01", paid: 0.96, scale: 0.96, state: "agrees" },
  { route: "Route R03", paid: 1.84, scale: 1.85, state: "under" },
  { route: "Route R02", paid: 1.95, scale: 1.93, state: "over" },
  { route: "Route R04", paid: 1.90, scale: 1.90, state: "agrees" },
] as const;
const EXAMPLE_PERIODS = [58, 64, 61, 70, 74, 79];

/** A moving graphic of example figures: the bars grow and the route rows fill in. Static when motion is reduced. */
function MaxPreviewGraphic() {
  return (
    <figure className="mt-6 overflow-hidden rounded-lg border border-line-strong bg-paper/60">
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line bg-surface">
        {[
          { label: "Routes Checked", value: "46", tone: "text-ink" },
          { label: "Underpaid", value: "£41.20", tone: "text-bad" },
          { label: "Agreeing", value: "41", tone: "text-good" },
        ].map((t) => (
          <div key={t.label} className="px-3 py-3 sm:px-4">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">{t.label}</p>
            <p className={`num mt-1 text-lg font-semibold tracking-tight sm:text-xl ${t.tone}`}>{t.value}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2.5 px-4 py-4">
        {EXAMPLE_ROUTES.map((r, i) => (
          <div key={r.route} className="grid grid-cols-[5.5rem_1fr_4.5rem] items-center gap-3 text-sm">
            <span className="truncate text-ink-soft">{r.route}</span>
            <span className="h-2 overflow-hidden rounded-full bg-sunken">
              <span
                className={`block h-full origin-left rounded-full motion-safe:animate-[grow_0.9s_ease-out_both] ${r.state === "under" ? "bg-bad" : r.state === "over" ? "bg-warn" : "bg-good"}`}
                style={{ width: `${Math.round((r.paid / 2) * 100)}%`, animationDelay: `${i * 0.15}s` }}
              />
            </span>
            <span className="num text-right text-xs font-medium text-ink-soft">{r.state === "agrees" ? "Agrees" : r.state === "under" ? "−£1.30" : "+£2.28"}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-line bg-surface px-4 py-4">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">Income, Last Six Periods</p>
        <div role="img" aria-label="Example income rising over six periods" className="mt-3 flex h-20 items-end gap-2">
          {EXAMPLE_PERIODS.map((v, i) => (
            <span
              key={i}
              className="flex-1 origin-bottom rounded-t-[2px] bg-accent-bar motion-safe:animate-[grow-up_0.8s_ease-out_both]"
              style={{ height: `${v}%`, animationDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
      </div>
      <figcaption className="border-t border-line px-4 py-2 text-xs text-muted">Example figures, for illustration only. Not customer data, and not a claim about what DPD owes.</figcaption>
    </figure>
  );
}

/**
 * Shown in place of a Max feature to accounts on Essential: the feature's name, a moving graphic of example figures, and one
 * button. It is offered where the feature is wanted, not on every page.
 */
export function UpgradeToMax({ isOwner, feature = "Insights" }: { isOwner: boolean; feature?: string }) {
  return (
    <Panel className="py-7">
      <p className="text-xs font-semibold uppercase tracking-wider text-accent">Max Plan</p>
      <p className="mt-2 text-xl font-semibold tracking-tight">Unlock {feature} with Max</p>
      <MaxPreviewGraphic />
      {isOwner ? (
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link href="/settings#plan" className={buttonClass("primary", "md")}>See the Max Plan</Link>
          <span className="text-sm text-muted">£{PLAN_PRICE_GBP.max} a month, every franchise included</span>
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
