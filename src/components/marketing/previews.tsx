import { Check, X } from "lucide-react";
import { formatGBP } from "@/lib/money";
import { EXAMPLE_CHECKS, EXAMPLE_DAILY_INCOME, EXAMPLE_DRIVERS, EXAMPLE_FRANCHISES, EXAMPLE_PERIOD, type ExampleDriver } from "@/lib/marketing/example";
import { cn } from "@/components/ui/cn";
import { ExampleTag, Frame, Leader } from "./primitives";

const rate = (d: ExampleDriver) => `${formatGBP(d.rate)} a ${d.basis === "Per day" ? "day" : "stop"}`;
const worked = (d: ExampleDriver) => (d.basis === "Per day" ? `${d.quantity} days` : `${d.quantity.toLocaleString("en-GB")} stops`);

function CheckBadge({ ok }: { ok: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium", ok ? "border-good/30 bg-good-soft text-good" : "border-bad/30 bg-bad-soft text-bad")}>
      {ok ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : <X className="size-3.5" strokeWidth={2.5} aria-hidden />}
      {ok ? "Matches the Invoice" : "Does Not Match"}
    </span>
  );
}

const STAT_CELL = ["border-r border-b sm:border-b-0", "border-b sm:border-b-0 sm:border-r", "border-r", "sm:border-r-0"];

/** The hero: one franchise's pay period at a glance, with its daily income, what is owed to drivers, and the invoice check. */
export function OverviewPreview() {
  const peak = Math.max(...EXAMPLE_DAILY_INCOME);
  const stats = [
    { label: "Income", value: formatGBP(EXAMPLE_PERIOD.income), sub: "from DPD" },
    { label: "DPD Charges", value: formatGBP(-EXAMPLE_PERIOD.charges), sub: "before VAT" },
    { label: "Driver Pay", value: formatGBP(-EXAMPLE_PERIOD.driverPay), sub: "three drivers" },
    { label: "Profit", value: formatGBP(EXAMPLE_PERIOD.profit), sub: "what is left", strong: true },
  ];
  return (
    <Frame title="Northside" subtitle="Four-week pay period">
      <dl className="grid grid-cols-2 sm:grid-cols-4">
        {stats.map((s, i) => (
          <div key={s.label} className={cn("border-line px-3.5 py-3.5 sm:px-4", STAT_CELL[i])}>
            <dt className="text-xs font-medium uppercase tracking-wider text-muted">{s.label}</dt>
            <dd className={cn("num mt-1 whitespace-nowrap text-lg tracking-tight sm:text-xl", s.strong ? "font-semibold text-ink" : "font-medium text-ink")}>{s.value}</dd>
            <dd className="mt-0.5 text-xs text-muted">{s.sub}</dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-line px-4 pb-3 pt-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">Daily income from DPD</p>
        <div role="img" aria-label="Example daily income over four weeks. Weekdays are the tallest, Saturdays are lower, Sundays have none." className="mt-3 flex h-24 items-end gap-2">
          {[0, 1, 2, 3].map((week) => (
            <div key={week} className="flex h-full flex-1 items-end gap-[3px]">
              {EXAMPLE_DAILY_INCOME.slice(week * 7, week * 7 + 7).map((v, d) => (
                <span
                  key={d}
                  className={cn("flex-1 rounded-t-[2px]", v === 0 ? "bg-line-strong" : d === 5 ? "bg-accent-bar/55" : "bg-accent-bar")}
                  style={{ height: v === 0 ? "2px" : `${Math.round((v / peak) * 100)}%` }}
                />
              ))}
            </div>
          ))}
        </div>
        <div aria-hidden className="mt-1.5 grid grid-cols-4 gap-2 text-[0.6875rem] text-muted">
          {["Week 1", "Week 2", "Week 3", "Week 4"].map((w) => <span key={w}>{w}</span>)}
        </div>
      </div>

      <div className="grid border-t border-line sm:grid-cols-2">
        <div className="px-4 py-4 sm:border-r sm:border-line">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">Owed to drivers</p>
          <dl className="mt-2.5 space-y-1.5 text-sm">
            {EXAMPLE_DRIVERS.map((d) => <Leader key={d.name} label={d.name} value={formatGBP(d.owed)} />)}
            <Leader label="Total" value={formatGBP(EXAMPLE_PERIOD.driverPay)} strong className="border-t border-line pt-1.5" />
          </dl>
        </div>
        <div className="border-t border-line px-4 py-4 sm:border-t-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">Invoice check</p>
          <div className="mt-2.5"><CheckBadge ok /></div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Leader label="Daily payments" value={formatGBP(EXAMPLE_CHECKS.matches.dailyPayments)} />
            <Leader label="Invoice stop pay" value={formatGBP(EXAMPLE_CHECKS.matches.invoiceStopPay)} />
          </dl>
        </div>
      </div>
    </Frame>
  );
}

export function DriverPayPreview() {
  return (
    <Frame title="Drivers This Pay Period" subtitle="Northside">
      <div className="overflow-x-auto">
        <table className="ledger tight">
          <thead>
            <tr>
              <th>Driver</th>
              <th className="hidden sm:table-cell">Paid</th>
              <th className="r">Worked</th>
              <th className="r">Owed</th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLE_DRIVERS.map((d) => (
              <tr key={d.name}>
                <td>
                  <span className="font-medium">{d.name}</span>
                  <span className="block text-xs text-muted sm:hidden">{rate(d)}</span>
                </td>
                <td className="hidden text-ink-soft sm:table-cell">{rate(d)}</td>
                <td className="r num text-ink-soft">{worked(d)}</td>
                <td className="r num font-medium">{formatGBP(d.owed)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="sm:hidden">Total</td>
              <td colSpan={3} className="hidden sm:table-cell">Total Driver Pay</td>
              <td className="r num">{formatGBP(EXAMPLE_PERIOD.driverPay)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Frame>
  );
}

function CheckBlock({ title, daily, invoice }: { title: string; daily: number; invoice: number }) {
  const gap = invoice - daily;
  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">{title}</p>
        <CheckBadge ok={gap === 0} />
      </div>
      <dl className="mt-3 space-y-1.5 text-[0.9375rem]">
        <Leader label="Money in (daily payments)" value={formatGBP(daily)} />
        <Leader label="Invoice stop pay" value={formatGBP(invoice)} />
      </dl>
      {gap !== 0 ? (
        <p className="mt-3 text-sm text-bad">Our daily payments are {formatGBP(Math.abs(gap))} less than the invoice. A day may be missing or posted late.</p>
      ) : null}
    </div>
  );
}

export function CheckPreview() {
  return (
    <Frame title="Period Check" subtitle="Our figures against DPD's invoice">
      <div className="divide-y divide-line">
        <CheckBlock title="A period that agrees" daily={EXAMPLE_CHECKS.matches.dailyPayments} invoice={EXAMPLE_CHECKS.matches.invoiceStopPay} />
        <CheckBlock title="A period with a missing day" daily={EXAMPLE_CHECKS.differs.dailyPayments} invoice={EXAMPLE_CHECKS.differs.invoiceStopPay} />
      </div>
    </Frame>
  );
}

export function FranchisesPreview() {
  const total = EXAMPLE_FRANCHISES.reduce(
    (t, f) => ({ drivers: t.drivers + f.drivers, stops: t.stops + f.stops, income: t.income + f.income, profit: t.profit + f.profit }),
    { drivers: 0, stops: 0, income: 0, profit: 0 },
  );
  return (
    <Frame title="Franchises This Pay Period" subtitle="One login, every franchise">
      <div className="overflow-x-auto">
        <table className="ledger tight">
          <thead>
            <tr>
              <th>Franchise</th>
              <th className="r hidden sm:table-cell">Drivers</th>
              <th className="r hidden sm:table-cell">Stops</th>
              <th className="r">Income</th>
              <th className="r">Profit</th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLE_FRANCHISES.map((f) => (
              <tr key={f.name}>
                <td className="font-medium">{f.name}</td>
                <td className="r num hidden sm:table-cell">{f.drivers}</td>
                <td className="r num hidden sm:table-cell">{f.stops.toLocaleString("en-GB")}</td>
                <td className="r num">{formatGBP(f.income)}</td>
                <td className="r num font-medium">{formatGBP(f.profit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>All Franchises</td>
              <td className="r num hidden sm:table-cell">{total.drivers}</td>
              <td className="r num hidden sm:table-cell">{total.stops.toLocaleString("en-GB")}</td>
              <td className="r num">{formatGBP(total.income)}</td>
              <td className="r num">{formatGBP(total.profit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Frame>
  );
}

/** A sheet of the PDF report, drawn as an illustration. A second sheet sits behind it: one report for every period. */
export function ReportPreview() {
  const glance = [
    { label: "Income from DPD", value: formatGBP(EXAMPLE_PERIOD.income), sub: "payments to you" },
    { label: "Driver wages", value: formatGBP(EXAMPLE_PERIOD.driverPay), sub: "pay for the period" },
    { label: "Expenses", value: formatGBP(EXAMPLE_PERIOD.charges), sub: "DPD charges" },
    { label: "Profit", value: formatGBP(EXAMPLE_PERIOD.profit), sub: "after expenses and wages" },
  ];
  return (
    <figure className="relative mx-auto w-full max-w-md pb-3 pr-3 lg:mx-0">
      <div aria-hidden className="absolute inset-0 translate-x-3 translate-y-3 rounded-md border border-line-strong bg-paper" />
      <div className="relative rounded-md border border-line-strong bg-surface p-5 shadow-[0_28px_56px_-28px_rgb(63_28_8/0.32)] sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted">Your Business Name</p>
            <p className="mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl">Period report</p>
            <p className="mt-0.5 text-sm text-ink-soft">Northside · four weeks</p>
          </div>
          <ExampleTag />
        </div>

        <p className="mt-6 border-b border-ink/70 pb-1.5 text-sm font-semibold">At a glance</p>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {glance.map((g) => (
            <div key={g.label} className="rounded border border-line bg-paper/60 px-3 py-2.5">
              <dt className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted">{g.label}</dt>
              <dd className="num mt-1 text-[1.0625rem] font-semibold">{g.value}</dd>
              <dd className="text-[0.6875rem] text-muted">{g.sub}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 border-b border-ink/70 pb-1.5 text-sm font-semibold">Income</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          <Leader label="Stop pay from DPD" value={formatGBP(EXAMPLE_PERIOD.income)} />
          <Leader label="Total income" value={formatGBP(EXAMPLE_PERIOD.income)} strong className="border-t border-line pt-1.5" />
        </dl>

        <div aria-hidden className="mt-6 space-y-2">
          <span className="block h-1.5 w-full rounded-full bg-line" />
          <span className="block h-1.5 w-11/12 rounded-full bg-line" />
          <span className="block h-1.5 w-2/3 rounded-full bg-line" />
        </div>
        <figcaption className="mt-5 border-t border-line pt-3 text-xs text-muted">Illustration of a PDF report, with example figures. Not customer data.</figcaption>
      </div>
    </figure>
  );
}
