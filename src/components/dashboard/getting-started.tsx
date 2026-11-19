import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Panel } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import type { ChecklistItem } from "@/lib/onboarding/steps";

/**
 * The set-up checklist: each step ticked off as it is done, and nothing once everything is done. After the first sync it
 * lists the drivers who still need a pay rate, each linked to their page.
 */
export function GettingStarted({ items, driversNeedingRate = [] }: { items: ChecklistItem[]; driversNeedingRate?: { id: string; name: string }[] }) {
  if (items.length === 0) return null;
  const left = items.filter((i) => !i.done).length;
  const next = items.find((i) => !i.done)?.key;
  return (
    <section aria-labelledby="getting-started" className="mb-8" data-testid="setup-checklist">
      <Panel className="border-accent/25 bg-gradient-to-br from-accent-soft/60 to-surface">
        <h2 id="getting-started" className="text-base font-semibold">{left === 1 ? "One step left to set up" : `${left} steps left to set up`}</h2>
        <p className="mt-0.5 text-sm text-muted">Your figures fill in as these are done.</p>
        <ol className="mt-4 space-y-3">
          {items.map((s, i) => (
            <li key={s.key} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  {s.done ? (
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-good text-white" aria-label="Done"><Check className="size-4" aria-hidden /></span>
                  ) : (
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white" aria-hidden>{i + 1}</span>
                  )}
                  <div>
                    <p className={s.done ? "font-medium text-ink-soft line-through decoration-1" : "font-medium"}>{s.title}</p>
                    <p className="text-sm text-ink-soft">{s.detail}</p>
                  </div>
                </div>
                {s.done ? null : (
                  <Link href={s.href} className={`${buttonClass(s.key === next ? "primary" : "secondary", "sm")} shrink-0`}>
                    {s.cta} <ArrowRight className="size-4" aria-hidden />
                  </Link>
                )}
              </div>
              {s.key === "rates" && !s.done && driversNeedingRate.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2 pl-10" aria-label="Drivers without a pay rate">
                  {driversNeedingRate.slice(0, 12).map((d) => (
                    <li key={d.id}><Link href={`/drivers/${d.id}`} className="inline-block rounded-full border border-line-strong px-3 py-1 text-sm hover:bg-sunken">{d.name}</Link></li>
                  ))}
                  {driversNeedingRate.length > 12 ? <li className="px-1 py-1 text-sm text-muted">and {driversNeedingRate.length - 12} more</li> : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </Panel>
    </section>
  );
}
