import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { DailyColumns, type DailyPoint } from "@/components/daily-columns";
import { SyncButtons } from "@/components/sync-buttons";
import { Badge, Notice, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { LinkButton } from "@/components/ui/button";
import { franchiseLabel, getContext } from "@/lib/context";
import { loadPeriodData } from "@/lib/data/period";
import { loadSyncOverview } from "@/lib/data/status";
import { addDays, eachDay, formatMonth, formatUkDate, formatUkDateLong, formatUkDayMonth, monthOf, monthRange } from "@/lib/dates";
import { buildDriverDays, summarisePeriod } from "@/lib/finance/calc";
import { FIGURE_STATUS, SEVERITY } from "@/lib/labels";
import { formatGBP, sumPence } from "@/lib/money";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await getContext();
  const { supabase, accountId, franchiseId, today } = ctx;
  const month = monthOf(today);
  const { start: monthStart } = monthRange(month);
  const trendStart = addDays(today, -13);
  const loadFrom = trendStart < monthStart ? trendStart : monthStart;

  const [data, sync, alertsResult, reviewsResult] = await Promise.all([
    loadPeriodData(supabase, { accountId, from: loadFrom, to: today, franchiseId }),
    loadSyncOverview(supabase, accountId),
    (() => {
      let q = supabase.from("anomalies").select("id, title, severity, subject_date, status, franchise_id", { count: "exact" })
        .in("status", ["open", "investigating"]).order("severity", { ascending: false }).order("subject_date", { ascending: false }).limit(5);
      if (franchiseId) q = q.eq("franchise_id", franchiseId);
      return q;
    })(),
    supabase.from("review_items").select("id, title", { count: "exact" }).eq("status", "open").order("created_at", { ascending: false }).limit(3),
  ]);

  // "Today" shows the latest day that has a DPD report, clearly dated, so the
  // figures are never blank just because tonight's sync has not run yet.
  const reportDates = [...new Set(data.earnings.map((e) => e.date))].sort();
  const latestDay = reportDates[reportDates.length - 1] ?? today;
  const dayIsToday = latestDay === today;
  const daySummary = summarisePeriod({ ...data, from: latestDay, to: latestDay, revenue: data.revenue.filter((r) => r.periodStart === r.periodEnd) }).combined;
  const monthSummary = summarisePeriod({ ...data, from: monthStart, to: today });
  const m = monthSummary.combined;

  const driverDays = buildDriverDays(data.earnings, data.adjustments, data.driverNames);
  const trend: DailyPoint[] = eachDay(trendStart, today).map((date) => {
    const days = driverDays.filter((d) => d.date === date);
    const value = sumPence(days.map((d) => d.finalEarnings));
    return { date, label: formatUkDate(date).slice(0, 5), value: Math.max(0, value), valueLabel: formatGBP(value), hasData: days.some((d) => d.hasReport) };
  });

  const alerts = alertsResult.data ?? [];
  const alertCount = alertsResult.count ?? 0;
  const reviewCount = reviewsResult.count ?? 0;
  const attention = alertCount + reviewCount;
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const maxFranchisePay = Math.max(1, ...monthSummary.franchises.map((f) => f.driverCosts));
  const topDrivers = [...m.drivers].filter((d) => d.daysWorked > 0).sort((a, b) => b.finalEarnings - a.finalEarnings).slice(0, 8);
  const noFranchises = ctx.franchises.length === 0;
  const noData = data.earnings.length === 0 && data.costs.length === 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${formatUkDateLong(today)} · ${ctx.franchise ? franchiseLabel(ctx.franchise) : "All franchises"}`}
        actions={
          ctx.canWrite ? (
            <>
              <LinkButton href="/adjustments/new">Add Pay Adjustment</LinkButton>
              <LinkButton href="/adjustments/cover" variant="secondary">Record Driver Cover</LinkButton>
              <LinkButton href="/expenses?add=1" variant="secondary">Add Expense</LinkButton>
            </>
          ) : null
        }
      />

      {noFranchises ? (
        <Notice tone="info" title="Welcome. Start by adding your first franchise." className="mb-6">
          Add your FD number in <Link href="/settings" className="font-medium text-accent underline">Settings</Link>, then add your drivers and upload or sync your first DPD report.
        </Notice>
      ) : null}

      {/* Is anything wrong? What needs my attention? */}
      <Section>
        {attention === 0 ? (
          <Panel className="flex items-center gap-3">
            <CheckCircle2 className="size-6 shrink-0 text-good" aria-hidden />
            <div>
              <p className="font-medium">Everything is up to date.</p>
              <p className="text-sm text-muted">Nothing needs your attention right now.</p>
            </div>
          </Panel>
        ) : (
          <Panel flush>
            <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
              <AlertTriangle className="size-5 shrink-0 text-warn" aria-hidden />
              <h2 className="font-semibold">
                {attention} {attention === 1 ? "thing needs" : "things need"} your attention
              </h2>
            </div>
            <ul>
              {reviewCount > 0 ? (
                <li className="border-b border-line last:border-0">
                  <Link href="/data#attention" className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/50 sm:px-5">
                    <Badge tone="warn">Import</Badge>
                    <span className="flex-1 text-[0.9375rem]">
                      {reviewCount === 1 ? (reviewsResult.data?.[0]?.title ?? "1 report needs checking") : `${reviewCount} reports need checking`}
                    </span>
                    <ChevronRight className="size-4 text-muted" aria-hidden />
                  </Link>
                </li>
              ) : null}
              {alerts.map((alert) => (
                <li key={alert.id} className="border-b border-line last:border-0">
                  <Link href={`/alerts#${alert.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/50 sm:px-5">
                    <Badge tone={SEVERITY[alert.severity]?.tone ?? "warn"}>{formatUkDate(alert.subject_date).slice(0, 5)}</Badge>
                    <span className="flex-1 text-[0.9375rem]">{alert.title}</span>
                    <ChevronRight className="size-4 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
              {alertCount > alerts.length ? (
                <li>
                  <Link href="/alerts" className="block px-4 py-3 text-sm font-medium text-accent hover:bg-sunken/50 sm:px-5">
                    See all {alertCount} alerts
                  </Link>
                </li>
              ) : null}
            </ul>
          </Panel>
        )}
      </Section>

      {/* Today */}
      <Section
        title={dayIsToday ? "Today" : `Latest report: ${formatUkDayMonth(latestDay)}`}
        description={dayIsToday ? undefined : reportDates.length === 0 ? "No DPD reports have been imported yet." : "Today's DPD report has not arrived yet, so these are the most recent figures."}
      >
        <Panel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
            <Stat size="lg" label="Earned by drivers" value={formatGBP(daySummary.driverOriginalEarnings)} sub="From DPD reports" />
            <Stat label="Driver pay" value={formatGBP(daySummary.driverCosts)} sub={daySummary.driverAdjustmentsNet === 0 ? "No adjustments" : `Includes ${formatGBP(daySummary.driverAdjustmentsNet, { signed: true })} adjustments`} />
            <Stat label="Fuel" value={formatGBP(daySummary.fuel)} />
            <Stat label="Other expenses" value={formatGBP(daySummary.otherExpenses)} />
          </div>
          <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
            {daySummary.driverCount} {daySummary.driverCount === 1 ? "driver" : "drivers"} · {daySummary.stops.toLocaleString("en-GB")} stops · {daySummary.parcels.toLocaleString("en-GB")} parcels
          </p>
        </Panel>
      </Section>

      {/* This month */}
      <Section title={formatMonth(month)} description="Month to date" actions={<LinkButton href="/reports" variant="secondary" size="sm">Generate Monthly Report</LinkButton>}>
        <Panel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
            <Stat
              label="Revenue"
              value={m.revenueStatus === "unavailable" ? "—" : formatGBP(m.revenueTotal)}
              status={<Badge tone={FIGURE_STATUS[m.revenueStatus]!.tone}>{FIGURE_STATUS[m.revenueStatus]!.label}</Badge>}
              sub={m.revenueStatus === "unavailable" ? <Link href="/settings#revenue" className="text-accent underline">Add revenue</Link> : undefined}
            />
            <Stat label="Driver pay" value={formatGBP(m.driverCosts)} sub={`${formatGBP(m.driverOriginalEarnings)} DPD ${m.driverAdjustmentsNet < 0 ? "−" : "+"} ${formatGBP(Math.abs(m.driverAdjustmentsNet))} adj.`} />
            <Stat label="Fuel" value={formatGBP(m.fuel)} />
            <Stat label="Other expenses" value={formatGBP(m.otherExpenses)} sub={m.unallocatedCosts > 0 ? <Link href="/expenses?show=unallocated" className="text-accent underline">{formatGBP(m.unallocatedCosts)} unallocated</Link> : undefined} />
            <Stat
              label="Operating profit"
              value={m.operatingProfit == null ? "—" : formatGBP(m.operatingProfit)}
              tone={m.operatingProfit == null ? undefined : m.operatingProfit < 0 ? "bad" : "good"}
              status={m.operatingProfit == null ? undefined : <Badge tone={FIGURE_STATUS[m.profitStatus]!.tone}>{FIGURE_STATUS[m.profitStatus]!.label}</Badge>}
              sub={m.operatingProfit == null ? "Shown once revenue is entered for every franchise" : m.marginPercent != null ? `${m.marginPercent}% margin` : undefined}
            />
          </div>
          {!noData ? (
            <div className="mt-6 border-t border-line pt-4">
              <DailyColumns points={trend} caption="Driver pay per day, last 14 days" />
            </div>
          ) : null}
        </Panel>
      </Section>

      {/* Franchise comparison */}
      {!ctx.franchise && monthSummary.franchises.filter((f) => f.franchiseId).length > 1 ? (
        <Section title="Franchises this month">
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Franchise</th>
                  <th className="r">Drivers</th>
                  <th className="r">Stops</th>
                  <th className="min-w-56">Driver pay</th>
                  <th className="r">Fuel</th>
                  <th className="r">Other</th>
                  <th className="r">Profit</th>
                </tr>
              </thead>
              <tbody>
                {monthSummary.franchises.filter((f) => f.franchiseId).map((f) => (
                  <tr key={f.franchiseId}>
                    <td className="font-medium">{franchiseName.get(f.franchiseId!) ?? "Franchise"}</td>
                    <td className="r num">{f.driverCount}</td>
                    <td className="r num">{f.stops.toLocaleString("en-GB")}</td>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 rounded-full bg-accent-soft" aria-hidden>
                          <div className="h-2 rounded-full bg-accent-bar" style={{ width: `${Math.max(2, (Math.max(0, f.driverCosts) / maxFranchisePay) * 100)}%` }} />
                        </div>
                        <span className="num w-24 text-right">{formatGBP(f.driverCosts)}</span>
                      </div>
                    </td>
                    <td className="r num">{formatGBP(f.fuel)}</td>
                    <td className="r num">{formatGBP(f.otherExpenses)}</td>
                    <td className="r num">
                      {f.operatingProfit == null ? <span className="text-muted">No revenue yet</span> : (
                        <span className={f.operatingProfit < 0 ? "text-bad" : ""}>
                          {formatGBP(f.operatingProfit)}{f.profitStatus === "estimated" ? " (est.)" : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      ) : null}

      {/* Driver performance */}
      {topDrivers.length > 0 ? (
        <Section title="Drivers this month" actions={<LinkButton href="/drivers" variant="quiet" size="sm">View Drivers</LinkButton>}>
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th className="r">Days</th>
                  <th className="r">Stops / day</th>
                  <th className="r">Per stop</th>
                  <th className="r">DPD earnings</th>
                  <th className="r">Adjustments</th>
                  <th className="r">Pay</th>
                </tr>
              </thead>
              <tbody>
                {topDrivers.map((d) => (
                  <tr key={`${d.franchiseId}-${d.key}`}>
                    <td className="font-medium">
                      {d.driverId ? <Link href={`/drivers/${d.driverId}`} className="hover:underline">{d.name}</Link> : <span>{d.name} <Badge tone="warn">Not registered</Badge></span>}
                    </td>
                    <td className="r num">{d.daysWorked}</td>
                    <td className="r num">{d.avgStopsPerDayX10 == null ? "—" : (d.avgStopsPerDayX10 / 10).toFixed(1)}</td>
                    <td className="r num">{formatGBP(d.earningsPerStop)}</td>
                    <td className="r num">{formatGBP(d.originalEarnings)}</td>
                    <td className="r num">{d.adjustmentsNet === 0 ? "—" : formatGBP(d.adjustmentsNet, { signed: true })}</td>
                    <td className="r num font-semibold">{formatGBP(d.finalEarnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      ) : null}

      {/* Synchronisation */}
      <Section title="Synchronisation" actions={<LinkButton href="/data" variant="quiet" size="sm">Data &amp; Integrations</LinkButton>}>
        <div className="grid gap-3 md:grid-cols-2">
          {[sync.dpd, sync.dropbox].map((s) => (
            <Notice key={s.key} tone={s.tone} title={s.headline}>{s.detail}</Notice>
          ))}
        </div>
        {ctx.canWrite ? <div className="mt-3"><SyncButtons dpdRunning={sync.dpd.running} dropboxRunning={sync.dropbox.running} dropboxConnected={sync.dropbox.tone !== "info" || sync.dropbox.running} /></div> : null}
      </Section>
    </>
  );
}
