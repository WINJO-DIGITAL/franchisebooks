import { Check } from "lucide-react";
import { formatGBP } from "@/lib/money";
import { EXAMPLE_CHECKS, EXAMPLE_DRIVERS, EXAMPLE_PERIOD, type ExampleDriver } from "@/lib/marketing/example";
import { cn } from "@/components/ui/cn";
import { ExampleTag } from "./primitives";

const worked = (d: ExampleDriver) =>
  d.basis === "Per day" ? `${d.quantity} days at ${formatGBP(d.rate)}` : `${d.quantity.toLocaleString("en-GB")} stops at ${formatGBP(d.rate)}`;

/**
 * The hero's payday sheet: what each driver is owed for the period and the invoice check, set large enough to read on a
 * phone. Example figures only, labelled as such.
 */
export function HeroPayday({ className }: { className?: string }) {
  const { dailyPayments, invoiceStopPay } = EXAMPLE_CHECKS.matches;
  return (
    <figure className={cn("mk-rise overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_1px_0_rgb(63_28_8/0.04),0_36px_64px_-32px_rgb(63_28_8/0.42)]", className)}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold leading-tight text-ink">Payday, Northside</p>
          <p className="mt-0.5 text-sm text-muted">Four-week period, read from DPD overnight</p>
        </div>
        <ExampleTag />
      </div>

      <div className="mt-5 border-y border-line bg-paper/60 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Owed to Drivers</p>
        <p className="num mt-1 text-4xl font-semibold tracking-tight text-ink">{formatGBP(EXAMPLE_PERIOD.driverPay)}</p>
      </div>

      <ul className="divide-y divide-line px-5">
        {EXAMPLE_DRIVERS.map((d, i) => (
          <li key={d.name} className="mk-rise flex items-baseline justify-between gap-3 py-3" style={{ animationDelay: `${180 + i * 110}ms` }}>
            <div className="min-w-0">
              <p className="font-semibold text-ink">{d.name}</p>
              <p className="num text-sm text-muted">{worked(d)}</p>
            </div>
            <p className="num shrink-0 text-lg font-semibold text-ink">{formatGBP(d.owed)}</p>
          </li>
        ))}
      </ul>

      <div className="mk-rise flex items-center gap-3 border-t border-good/25 bg-good-soft px-5 py-3.5" style={{ animationDelay: "560ms" }}>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-good text-white">
          <Check className="size-4" strokeWidth={3} aria-hidden />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-good">Matches DPD&rsquo;s Invoice</p>
          <p className="num text-ink-soft">Daily payments {formatGBP(dailyPayments)}, invoice {formatGBP(invoiceStopPay)}</p>
        </div>
      </div>
      <figcaption className="sr-only">Illustration with example figures. Not customer data.</figcaption>
    </figure>
  );
}
