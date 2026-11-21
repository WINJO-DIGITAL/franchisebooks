import { ArrowDown, ArrowRight, Check, FileText, Moon, Users } from "lucide-react";
import { formatGBP } from "@/lib/money";
import { EXAMPLE_DRIVERS, EXAMPLE_PERIOD } from "@/lib/marketing/example";
import { cn } from "@/components/ui/cn";

function Node({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border border-line-strong bg-surface p-4 shadow-[0_18px_36px_-24px_rgb(63_28_8/0.35)]", className)}>{children}</div>;
}

/** The nightly read drawn as a picture: the DPD portal on the left, what the owner gets on the right. Example figures. */
export function HowFlow() {
  return (
    <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,15rem)_auto_minmax(0,1fr)] lg:gap-6">
      <Node>
        <p className="text-sm font-semibold text-ink">Your DPD Portal</p>
        <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
          {["Daily payments", "Charges", "Invoices"].map((t) => (
            <li key={t} className="flex items-center gap-2 rounded-md bg-sunken/70 px-2.5 py-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-accent-bar" />
              {t}
            </li>
          ))}
        </ul>
      </Node>

      <div className="flex items-center justify-center gap-2 py-1 text-sm font-semibold text-accent lg:flex-col lg:gap-1.5">
        <Moon className="size-4" aria-hidden />
        <span>Read every night</span>
        <ArrowDown className="size-4 lg:hidden" aria-hidden />
        <ArrowRight className="hidden size-5 lg:block" aria-hidden />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Node>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Users className="size-4 text-accent" aria-hidden /> Driver Pay</p>
          <p className="num mt-3 text-2xl font-semibold tracking-tight">{formatGBP(EXAMPLE_PERIOD.driverPay)}</p>
          <p className="mt-1 text-sm text-ink-soft">Owed to {EXAMPLE_DRIVERS.length} drivers.</p>
        </Node>
        <Node>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Check className="size-4 text-good" strokeWidth={2.5} aria-hidden /> Invoice Check</p>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-good-soft px-2.5 py-1.5 text-sm font-semibold text-good">
            <Check className="size-3.5" strokeWidth={3} aria-hidden /> Matches DPD
          </p>
          <p className="mt-2 text-sm text-ink-soft">Or shows what&rsquo;s missing.</p>
        </Node>
        <Node>
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><FileText className="size-4 text-accent" aria-hidden /> Period Report</p>
          <div aria-hidden className="mt-3 space-y-1.5">
            <span className="block h-2 w-3/4 rounded bg-line-strong" />
            <span className="block h-2 w-full rounded bg-line" />
            <span className="block h-2 w-5/6 rounded bg-line" />
          </div>
          <p className="mt-2.5 text-sm text-ink-soft">PDF, the Monday after each period.</p>
        </Node>
      </div>
    </div>
  );
}
