import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, Notice, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import { formatUkDate, formatUkDateLong, isISODate, londonToday } from "@/lib/dates";
import { getDriverContext } from "@/lib/driver/context";
import { loadDriverPage } from "@/lib/driver/data";
import { periodContaining, periodLabel, recentPeriods } from "@/lib/finance/periods";
import { formatGBP } from "@/lib/money";

export const metadata: Metadata = { title: "Your Pay" };

export default async function MyPayPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const params = await searchParams;
  const ctx = await getDriverContext();
  const today = londonToday();
  const period = isISODate(params.period) ? periodContaining(params.period) : periodContaining(today);
  const { name, statement: s, files } = await loadDriverPage(ctx, period);

  return (
    <>
      <PageHeader title={name ? `Hello, ${name.split(" ")[0]}` : "Your pay"} description={`Your days and pay for ${periodLabel(period)}.`} />

      <nav aria-label="Pay period" className="-mt-2 mb-6 flex flex-wrap gap-2">
        {recentPeriods(today, 4).map((p) => (
          <Link key={p.start} href={`/my?period=${p.start}`} className={buttonClass(p.start === period.start ? "primary" : "secondary", "sm")}>{periodLabel(p)}</Link>
        ))}
      </nav>

      {s.unpricedDates.length > 0 ? (
        <Notice tone="warn" title="Some Days Have No Pay Shown Yet" className="mb-6">
          Your pay rate has not been set up for {s.unpricedDates.length} of these days. Ask your manager, and the figure will appear.
        </Notice>
      ) : null}

      <Section>
        <Panel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            <Stat size="lg" label="Total pay" value={formatGBP(s.total)} sub={s.adjustmentsNet === 0 ? undefined : `Includes ${formatGBP(s.adjustmentsNet, { signed: true })} adjustments`} />
            <Stat label="Days worked" value={String(s.daysWorked)} />
            <Stat label="Stops" value={s.stops.toLocaleString("en-GB")} />
            <Stat label="From your days" value={formatGBP(s.dayPay)} />
          </div>
        </Panel>
      </Section>

      <Section title="Your Days">
        {s.days.length === 0 ? (
          <EmptyState title="No Days in This Period Yet">Days appear here once they have been read from DPD.</EmptyState>
        ) : (
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr><th>Date</th><th className="hidden sm:table-cell">Route</th><th className="r">Stops</th><th className="r hidden sm:table-cell">Parcels</th><th className="r hidden sm:table-cell">Miles</th><th className="r">Pay</th></tr>
              </thead>
              <tbody>
                {s.days.map((d) => (
                  <tr key={d.date}>
                    <td className="num whitespace-nowrap">{formatUkDateLong(d.date)}</td>
                    <td className="num hidden sm:table-cell">{d.route ?? "—"}</td>
                    <td className="r num">{d.stops ?? "—"}</td>
                    <td className="r num hidden sm:table-cell">{d.parcels ?? "—"}</td>
                    <td className="r num hidden sm:table-cell">{d.mileage ?? "—"}</td>
                    <td className="r num font-medium">
                      {d.pay == null ? null : formatGBP(d.pay)}
                      {d.workings ? <span className="mt-0.5 block text-xs font-normal text-muted">{d.workings}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      {s.adjustments.length > 0 ? (
        <Section title="Adjustments" description="Extra payments and deductions added to your pay.">
          <TableWrap>
            <table className="ledger">
              <thead><tr><th>Date</th><th>What</th><th>Reason</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {s.adjustments.map((a, i) => (
                  <tr key={a.date + i}>
                    <td className="num whitespace-nowrap">{formatUkDate(a.date)}</td>
                    <td>{a.label}{a.reversal ? <Badge className="ml-2">Reversal</Badge> : null}</td>
                    <td className="text-ink-soft">{a.reason}</td>
                    <td className="r num">{formatGBP(a.amount, { signed: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      ) : null}

      <Section title="Your Statements" description="A statement of your pay for each pay period, made when the period closes.">
        {files.length === 0 ? (
          <EmptyState title="No Statements Yet">Your first statement appears here once a pay period has closed.</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {files.map((f) => (
              <li key={f.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{periodLabel({ start: f.periodStart, end: f.periodEnd })}</p>
                  <p className="text-sm text-ink-soft"><span className="num">{f.number}</span> · Total <span className="num">{formatGBP(f.totalPayable)}</span></p>
                </div>
                <a className={`${buttonClass("secondary", "sm")} shrink-0`} href={`/api/my/statements/${f.id}`} download>Download {f.title === "Self-billed invoice" ? "invoice" : "statement"}</a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
