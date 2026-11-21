import type { Metadata } from "next";
import Link from "next/link";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { AddMenu } from "@/components/add-menu";
import { DailyColumns, type DailyPoint } from "@/components/daily-columns";
import { SyncButtons } from "@/components/sync-buttons";
import { Badge, Notice, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { LinkButton } from "@/components/ui/button";
import { currentPlan } from "@/lib/billing/plan";
import { franchiseLabel, getContext } from "@/lib/context";
import { loadPeriodData } from "@/lib/data/period";
import { loadSyncOverview } from "@/lib/data/status";
import { dpdSetupReady } from "@/lib/dpd/readiness";
import { addDays, eachDay, formatUkDate, formatUkDateLong, formatUkDayMonth } from "@/lib/dates";
import { DUE_SOON_DAYS } from "@/lib/compliance/dates";
import { periodContaining, periodLabel } from "@/lib/finance/periods";
import { summariseCosts } from "@/lib/finance/cost-summary";
import { buildDriverDays, driverIdentity, mergeDriverRows, summarisePeriod } from "@/lib/finance/calc";
import { FIGURE_STATUS } from "@/lib/labels";
import { setupChecklist } from "@/lib/onboarding/steps";
import { formatGBP, sumPence } from "@/lib/money";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await getContext();
  const { supabase, accountId, franchiseId, today } = ctx;
  const maxPlan = (await currentPlan(supabase)) === "max";
  const period = periodContaining(today);
  const monthStart = period.start;

  // Driver and vehicle dates that have passed or fall within the next month. Read on its own so the dashboard still loads without them.
  const datesDue = await supabase.from("compliance_dates").select("id", { count: "exact", head: true }).eq("account_id", accountId).lte("expires_on", addDays(today, DUE_SOON_DAYS));
  const [data, sync] = await Promise.all([
    loadPeriodData(supabase, { accountId, from: monthStart, to: today, franchiseId, hiddenFranchiseIds: ctx.hiddenFranchiseIds }),
    loadSyncOverview(supabase, accountId),
  ]);

  // "Today" shows the latest day that has a DPD report, clearly dated, so the
  // figures are never blank just because tonight's sync has not run yet.
  const reportDates = [...new Set(data.earnings.map((e) => e.date))].sort();
  const latestDay = reportDates[reportDates.length - 1] ?? today;
  const dayIsToday = latestDay === today;
  const daySummary = summarisePeriod({ ...data, from: latestDay, to: latestDay, revenue: data.revenue.filter((r) => r.periodStart === r.periodEnd), otherPayments: [] }).combined;
  const monthSummary = summarisePeriod({ ...data, from: monthStart, to: today });
  const m = monthSummary.combined;
  // In "route_income" mode the imported DPD payments are income to the business, and wages come from day rates.
  const routeIncome = m.earningsMeaning === "route_income";

  const driverDays = buildDriverDays(data.earnings, data.adjustments, data.driverNames);
  const trend: DailyPoint[] = eachDay(monthStart, today).map((date) => {
    const days = driverDays.filter((d) => d.date === date);
    const value = sumPence(days.map((d) => (routeIncome ? d.originalEarnings : d.finalEarnings)));
    return { date, label: formatUkDate(date).slice(0, 5), value: Math.max(0, value), valueLabel: formatGBP(value), hasData: days.some((d) => d.hasReport) };
  });

  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const maxFranchisePay = Math.max(1, ...monthSummary.franchises.map((f) => (routeIncome ? f.incomeFromDpd : f.driverCosts)));
  const franchiseRows = monthSummary.franchises.filter((f) => f.franchiseId);
  const franchiseTotals = {
    income: franchiseRows.reduce((t, f) => t + f.incomeFromDpd, 0),
    wages: franchiseRows.reduce((t, f) => t + f.wages, 0),
    costs: franchiseRows.reduce((t, f) => t + f.fuel + f.otherExpenses, 0),
    profit: franchiseRows.reduce((t, f) => t + f.incomeFromDpd - f.wages - f.fuel - f.otherExpenses, 0),
  };
  // One row per person, even when they work for more than one franchise.
  const rankedDrivers = mergeDriverRows([...m.drivers].filter((d) => d.daysWorked > 0)).sort((a, b) => (routeIncome ? b.originalEarnings - a.originalEarnings : b.finalEarnings - a.finalEarnings));
  // Totals cover every driver with days this period, so they reconcile to the franchise profit. Profit / loss is income less wage.
  const totalIncomeAll = rankedDrivers.reduce((t, d) => t + d.originalEarnings, 0);
  const totalWageAll = rankedDrivers.reduce((t, d) => t + (d.wage ?? 0), 0);
  // Route numbers per driver this pay period, shown with a slash between them so they never read as one large number.
  const routesByDriver = new Map<string, Set<string>>();
  const franchisesByDriver = new Map<string, Set<string>>();
  for (const e of data.earnings.filter((e) => e.date >= monthStart)) {
    const k = driverIdentity(e.driverId, e.sourceDriverName);
    if (e.route) routesByDriver.set(k, (routesByDriver.get(k) ?? new Set()).add(e.route));
    franchisesByDriver.set(k, (franchisesByDriver.get(k) ?? new Set()).add(franchiseName.get(e.franchiseId) ?? ""));
  }
  const noFranchises = ctx.franchises.length === 0;
  const noData = data.earnings.length === 0 && data.costs.length === 0;
  const [{ data: dpdConnection }, { count: everRead }] = await Promise.all([
    ctx.supabase.from("integration_connections").select("config, last_success_at").eq("account_id", accountId).eq("provider", "dpd").maybeSingle(),
    // Any DPD payment ever read (not just this pay period), so the checklist does not come back at the start of each period.
    data.earnings.length > 0 ? Promise.resolve({ count: 1 }) : ctx.supabase.from("daily_earnings").select("id", { count: "exact", head: true }).eq("account_id", accountId).limit(1),
  ]);
  const rateDriverIds = new Set((data.dayRates ?? []).map((r) => r.driverId));
  const workedDriverIds = new Set(data.earnings.map((e) => e.driverId).filter((id): id is string => id != null));
  // The franchisee (the owner who drives, if they do) does not need a day rate, so is not asked for one.
  const { data: franchiseeRows } = await ctx.supabase.from("drivers").select("id").eq("account_id", accountId).eq("is_franchisee", true);
  const franchiseeIds = new Set((franchiseeRows ?? []).map((r) => r.id));
  const driversNeedingRate = [...workedDriverIds].filter((id) => !rateDriverIds.has(id) && !franchiseeIds.has(id))
    .map((id) => ({ id, name: data.driverNames.get(id) ?? "Driver" }))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  const setupItems = setupChecklist({
    franchiseCount: ctx.franchises.length,
    hasDpdLogin: dpdSetupReady(dpdConnection?.config),
    // A successful read counts even when DPD shows no payments (an ended franchise has none), so the step does not ask again.
    firstReadDone: (everRead ?? 0) > 0 || Boolean(dpdConnection?.last_success_at),
    driverCount: data.driverNames.size,
    driversWithoutRate: driversNeedingRate.length,
    // Pay rates always matter: driver statements and wages are worked out from them, whichever way DPD figures are read.
    ratesMatter: true,
  });

  return (
    <>
      {(datesDue.count ?? 0) > 0 ? (
        <div className="mb-6">
          <Notice tone="warn" title={`${datesDue.count} driver or vehicle date${datesDue.count === 1 ? "" : "s"} overdue or due within ${DUE_SOON_DAYS} days`}>
            <Link href="/drivers#dates" className="underline">Open Driver and Vehicle Dates</Link>
          </Notice>
        </div>
      ) : null}
      <PageHeader
        title="Dashboard"
        description={`${formatUkDateLong(today)} · ${ctx.franchise ? franchiseLabel(ctx.franchise) : "All franchises"}`}
        actions={ctx.canWrite ? <AddMenu showCover={maxPlan} /> : null}
        inline
      />

      {ctx.canWrite ? <GettingStarted items={setupItems} driversNeedingRate={driversNeedingRate} /> : null}

      {/* Today */}
      <Section
        title={dayIsToday ? "Today" : `Latest report: ${formatUkDayMonth(latestDay)}`}
        description={dayIsToday || reportDates.length > 0 ? undefined : "No DPD reports have been imported yet."}
      >
        <Panel>
          {routeIncome ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
              <Stat size="lg" tone="good" label="Income" value={formatGBP(daySummary.incomeFromDpd, { signed: true })} />
              <Stat label="Drivers working" value={String(daySummary.driverCount)} />
              <Stat label="Stops" value={daySummary.stops.toLocaleString("en-GB")} />
              <Stat label="Parcels" value={daySummary.parcels.toLocaleString("en-GB")} />
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
            <Stat size="lg" tone="good" label="Earned by drivers" value={formatGBP(daySummary.driverOriginalEarnings, { signed: true })} sub="From DPD reports" />
            <Stat tone="bad" label="Driver pay" value={formatGBP(daySummary.driverCosts)} sub={daySummary.driverAdjustmentsNet === 0 ? "No adjustments" : `Includes ${formatGBP(daySummary.driverAdjustmentsNet, { signed: true })} adjustments`} />
            <Stat tone="bad" label="Fuel" value={formatGBP(daySummary.fuel)} />
            <Stat tone="bad" label="Other expenses" value={formatGBP(daySummary.otherExpenses)} />
          </div>
          )}
          {routeIncome ? null : (
            <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
              {daySummary.driverCount} {daySummary.driverCount === 1 ? "driver" : "drivers"} · {daySummary.stops.toLocaleString("en-GB")} stops · {daySummary.parcels.toLocaleString("en-GB")} parcels
            </p>
          )}
        </Panel>
      </Section>

      {/* This pay period */}
      <Section title={periodLabel(period)} description="Pay period to date" actions={<LinkButton href="/reports" variant="secondary" size="sm">Generate Pay Period Report</LinkButton>}>
        <Panel>
          {routeIncome ? (
            <>
              {(() => {
                // Money out is shown in brackets. Costs are stated before VAT, and VAT is taken from the expense documents as stated.
                const unavailable = m.revenueStatus === "unavailable";
                const income = m.revenueTotal;
                const wages = m.wages;
                const fuel = m.fuel;
                const other = m.otherExpenses;
                const costsBefore = wages + fuel + other;
                const vatOnCosts = summariseCosts(data.costs).vat;
                const costsWith = costsBefore + vatOnCosts;
                const profitBefore = income - costsBefore;
                const profitWith = income - costsWith;
                const bracket = (pence: number) => (pence < 0 ? `(${formatGBP(-pence)})` : formatGBP(pence));
                // Income is green and money out is red, as everywhere else on the site.
                const line = (label: string, value: string, opts: { strong?: boolean; indent?: boolean; tone?: "good" | "bad" } = {}) => (
                  <div className="flex items-baseline justify-between gap-4 py-2">
                    <dt className={`${opts.indent ? "pl-4 text-ink-soft" : ""} ${opts.strong ? "font-semibold" : ""}`}>{label}</dt>
                    <dd className={`num font-semibold ${opts.tone === "good" ? "text-good" : opts.tone === "bad" ? "text-bad" : "text-ink"}`}>{value}</dd>
                  </div>
                );
                return (
                  <div>
                    <dl className="divide-y divide-line text-[0.9375rem]">
                      {line("Income", unavailable ? "—" : bracket(income), { strong: true, tone: "good" })}
                      {line("Driver wages", unavailable ? "—" : bracket(-wages), { indent: true, tone: "bad" })}
                      {line("Fuel", unavailable ? "—" : bracket(-fuel), { indent: true, tone: "bad" })}
                      {line("Other expenses", unavailable ? "—" : bracket(-other), { indent: true, tone: "bad" })}
                      {line("Costs before VAT", unavailable ? "—" : bracket(-costsBefore), { strong: true, tone: "bad" })}
                      {line("VAT on costs", unavailable ? "—" : bracket(-vatOnCosts), { indent: true, tone: "bad" })}
                      {line("Costs with VAT", unavailable ? "—" : bracket(-costsWith), { strong: true, tone: "bad" })}
                    </dl>
                    <div className={`mt-4 flex items-center justify-between gap-4 rounded-lg px-4 py-4 ${!unavailable && profitBefore < 0 ? "bg-bad-soft" : "bg-good-soft"}`}>
                      <dt className="font-semibold text-ink">Profit / (Loss) before VAT</dt>
                      <dd className={`num text-3xl font-bold tracking-tight ${!unavailable && profitBefore < 0 ? "text-bad" : "text-good"}`}>{unavailable ? "—" : bracket(profitBefore)}</dd>
                    </div>
                    <dl className="mt-2 divide-y divide-line text-[0.9375rem]">
                      {line("Profit / (Loss) with VAT", unavailable ? "—" : bracket(profitWith), { strong: true, tone: !unavailable && profitWith < 0 ? "bad" : "good" })}
                    </dl>
                  </div>
                );
              })()}
            </>
          ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
            <Stat
              label="Revenue"
              value={m.revenueStatus === "unavailable" ? "—" : formatGBP(m.revenueTotal)}
              status={<Badge tone={FIGURE_STATUS[m.revenueStatus]!.tone}>{FIGURE_STATUS[m.revenueStatus]!.label}</Badge>}
              sub={m.revenueStatus === "unavailable" ? <Link href="/settings#revenue" className="text-accent underline">Add revenue</Link> : undefined}
            />
            <Stat tone="bad" label="Driver pay" value={formatGBP(m.driverCosts)} sub={`${formatGBP(m.driverOriginalEarnings)} DPD ${m.driverAdjustmentsNet < 0 ? "−" : "+"} ${formatGBP(Math.abs(m.driverAdjustmentsNet))} adj.`} />
            <Stat tone="bad" label="Fuel" value={formatGBP(m.fuel)} />
            <Stat tone="bad" label="Other expenses" value={formatGBP(m.otherExpenses)} sub={m.unallocatedCosts > 0 ? <Link href="/expenses?show=unallocated" className="text-accent underline">{formatGBP(m.unallocatedCosts)} unallocated</Link> : undefined} />
            <Stat
              label="Operating profit"
              value={m.operatingProfit == null ? "—" : formatGBP(m.operatingProfit)}
              tone={m.operatingProfit == null ? undefined : m.operatingProfit < 0 ? "bad" : "good"}
              status={m.operatingProfit == null ? undefined : <Badge tone={FIGURE_STATUS[m.profitStatus]!.tone}>{FIGURE_STATUS[m.profitStatus]!.label}</Badge>}
              sub={m.operatingProfit == null ? "Shown once revenue is entered for every franchise" : m.marginPercent != null ? `${m.marginPercent}% margin` : undefined}
            />
          </div>
          )}
          {!noData ? (
            <div className="mt-6 border-t border-line pt-4">
              <DailyColumns points={trend} caption={routeIncome ? "Income per day" : "Driver pay per day"} />
            </div>
          ) : null}
        </Panel>
      </Section>

      {/* Franchise comparison */}
      {!ctx.franchise && franchiseRows.length > 1 ? (
        <Section title="Franchises This Pay Period">
          {routeIncome ? (
            <>
              <Panel flush className="sm:hidden">
                <ul className="divide-y divide-line">
                  {franchiseRows.map((f) => (
                    <li key={`m-${f.franchiseId}`} className="px-4 py-3.5">
                      <p className="font-medium">{franchiseName.get(f.franchiseId!) ?? "Franchise"}</p>
                      <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
                        <div><p className="text-xs text-muted">Income</p><p className="num font-medium text-good">{formatGBP(f.incomeFromDpd, { signed: true })}</p></div>
                        <div><p className="text-xs text-muted">Wages</p><p className="num font-medium text-bad">−{formatGBP(f.wages)}</p></div>
                        <div><p className="text-xs text-muted">Costs</p><p className="num font-medium text-bad">−{formatGBP(f.fuel + f.otherExpenses)}</p></div>
                        <div className={`-my-1 rounded-md px-2 py-1 ${f.incomeFromDpd - f.wages - f.fuel - f.otherExpenses < 0 ? "bg-bad-soft" : "bg-good-soft"}`}><p className="text-xs font-medium text-ink-soft">Profit / Loss</p><p className={`num font-bold ${f.incomeFromDpd - f.wages - f.fuel - f.otherExpenses < 0 ? "text-bad" : "text-good"}`}>{formatGBP(f.incomeFromDpd - f.wages - f.fuel - f.otherExpenses, { signed: true })}</p></div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="border-t-2 border-line-strong bg-sunken/50 px-4 py-3.5">
                  <p className="text-sm font-semibold">Total, {franchiseRows.length} franchises</p>
                  <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div><p className="text-xs text-muted">Income</p><p className="num font-semibold text-good">{formatGBP(franchiseTotals.income, { signed: true })}</p></div>
                    <div><p className="text-xs text-muted">Wages</p><p className="num font-semibold text-bad">−{formatGBP(franchiseTotals.wages)}</p></div>
                    <div><p className="text-xs text-muted">Costs</p><p className="num font-semibold text-bad">−{formatGBP(franchiseTotals.costs)}</p></div>
                    <div className={`-my-1 rounded-md px-2 py-1 ${franchiseTotals.profit < 0 ? "bg-bad-soft" : "bg-good-soft"}`}><p className="text-xs font-medium text-ink-soft">Profit / Loss</p><p className={`num font-bold ${franchiseTotals.profit < 0 ? "text-bad" : "text-good"}`}>{formatGBP(franchiseTotals.profit, { signed: true })}</p></div>
                  </div>
                </div>
              </Panel>
              <div className="hidden sm:block">
                <TableWrap>
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th>Franchise</th>
                        <th className="r">Income</th>
                        <th className="r">Wages</th>
                        <th className="r">Expenses</th>
                        <th className="r">Profit / Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {franchiseRows.map((f) => {
                        const profit = f.incomeFromDpd - f.wages - f.fuel - f.otherExpenses;
                        return (
                          <tr key={f.franchiseId}>
                            <td className="font-medium">{franchiseName.get(f.franchiseId!) ?? "Franchise"}</td>
                            <td className="r num text-good">{formatGBP(f.incomeFromDpd, { signed: true })}</td>
                            <td className="r num text-bad">−{formatGBP(f.wages)}</td>
                            <td className="r num text-bad">−{formatGBP(f.fuel + f.otherExpenses)}</td>
                            <td className={`r num font-bold ${profit < 0 ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>{formatGBP(profit, { signed: true })}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-line-strong font-semibold">
                        <td>Total</td>
                        <td className="r num text-good">{formatGBP(franchiseTotals.income, { signed: true })}</td>
                        <td className="r num text-bad">−{formatGBP(franchiseTotals.wages)}</td>
                        <td className="r num text-bad">−{formatGBP(franchiseTotals.costs)}</td>
                        <td className={`r num font-bold ${franchiseTotals.profit < 0 ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>{formatGBP(franchiseTotals.profit, { signed: true })}</td>
                      </tr>
                    </tfoot>
                  </table>
                </TableWrap>
              </div>
            </>
          ) : (
            <TableWrap>
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Franchise</th>
                    <th className="r hidden sm:table-cell">Drivers</th>
                    <th className="r hidden sm:table-cell">Stops</th>
                    <th className="sm:min-w-56">Driver pay</th>
                    <th className="r hidden sm:table-cell">Fuel</th>
                    <th className="r hidden sm:table-cell">Other</th>
                    <th className="r">Profit / Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {franchiseRows.map((f) => (
                    <tr key={f.franchiseId}>
                      <td className="font-medium">{franchiseName.get(f.franchiseId!) ?? "Franchise"}</td>
                      <td className="r num hidden sm:table-cell">{f.driverCount}</td>
                      <td className="r num hidden sm:table-cell">{f.stops.toLocaleString("en-GB")}</td>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="hidden h-2 flex-1 rounded-full bg-accent-soft sm:block" aria-hidden>
                            <div className="h-2 rounded-full bg-accent-bar" style={{ width: `${Math.max(2, (Math.max(0, f.driverCosts) / maxFranchisePay) * 100)}%` }} />
                          </div>
                          <span className="num w-24 text-right">{formatGBP(f.driverCosts)}</span>
                        </div>
                      </td>
                      <td className="r num hidden sm:table-cell">{formatGBP(f.fuel)}</td>
                      <td className="r num hidden sm:table-cell">{formatGBP(f.otherExpenses)}</td>
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
          )}
        </Section>
      ) : null}

      {/* Driver performance */}
      {rankedDrivers.length > 0 ? (
        <Section title="Drivers This Pay Period" actions={<LinkButton href="/drivers" variant="quiet" size="sm">View Drivers</LinkButton>}>
          <TableWrap>
            <table className="ledger [&_td]:!px-1.5 [&_th]:!px-1.5 [&_th]:tracking-normal [&_th]:text-[0.6875rem] sm:[&_th]:text-xs sm:[&_td]:!px-3 sm:[&_th]:!px-3">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th className="r hidden sm:table-cell">Days</th>
                  <th className="r hidden sm:table-cell">Stops / Day</th>
                  <th className="r hidden sm:table-cell">{routeIncome ? "Income / stop" : "Per stop"}</th>
                  <th className="r">{routeIncome ? "Income" : "DPD earnings"}</th>
                  {routeIncome ? null : <th className="r">Adjustments</th>}
                  <th className="r">{routeIncome ? "Wage" : "Pay"}</th>
                  {routeIncome ? <th className="r whitespace-normal">Profit / Loss</th> : null}
                </tr>
              </thead>
              <tbody>
                {rankedDrivers.map((d) => (
                  <tr key={d.key}>
                    <td className="font-medium max-w-[7.5rem] break-words sm:max-w-none">
                      {d.driverId ? <Link href={`/drivers/${d.driverId}`} className="hover:underline">{d.name}</Link> : <span>{d.name} <Badge tone="warn">Not registered</Badge></span>}
                      {(() => {
                        const identity = driverIdentity(d.driverId, d.name);
                        const routes = [...(routesByDriver.get(identity) ?? [])].sort((a, b) => a.localeCompare(b, "en-GB", { numeric: true }));
                        const franchisesHere = [...(franchisesByDriver.get(identity) ?? [])].filter(Boolean);
                        const where = [!ctx.franchise && franchisesHere.length ? franchisesHere.join(", ") : null, routes.length ? `Route ${routes.join(" / ")}` : null].filter(Boolean).join(" · ");
                        return where ? <span className="hidden text-xs font-normal text-muted sm:block">{where}</span> : null;
                      })()}
                    </td>
                    <td className="r num hidden sm:table-cell">{d.daysWorked}</td>
                    <td className="r num hidden sm:table-cell">{d.avgStopsPerDayX10 == null ? "—" : (d.avgStopsPerDayX10 / 10).toFixed(1)}</td>
                    <td className="r num hidden sm:table-cell">{formatGBP(d.earningsPerStop)}</td>
                    <td className={`r num whitespace-nowrap text-[0.8125rem] tracking-tight sm:text-base ${routeIncome ? "text-good" : ""}`}>{formatGBP(d.originalEarnings, { signed: true })}</td>
                    {routeIncome ? null : <td className="r num">{d.adjustmentsNet === 0 ? "—" : formatGBP(d.adjustmentsNet, { signed: true })}</td>}
                    <td className={`r num whitespace-nowrap text-[0.8125rem] tracking-tight font-semibold sm:text-base ${routeIncome ? "text-bad" : ""}`}>
                      {routeIncome ? `−${formatGBP(d.wage ?? 0)}` : formatGBP(d.finalEarnings)}
                    </td>
                    {routeIncome ? (
                      <td className={`r num whitespace-nowrap text-[0.8125rem] tracking-tight font-bold sm:text-base ${d.originalEarnings - (d.wage ?? 0) < 0 ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>
                        {formatGBP(d.originalEarnings - (d.wage ?? 0), { signed: true })}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              {routeIncome ? (
                <tfoot>
                  <tr className="border-t-2 border-line-strong font-semibold">
                    <td className="align-middle">
                      <span className="block">Total</span>
                      <span className="block text-xs font-normal text-muted">{rankedDrivers.length} {rankedDrivers.length === 1 ? "driver" : "drivers"}</span>
                    </td>
                    <td className="r num hidden sm:table-cell" colSpan={3} />
                    <td className="r num whitespace-nowrap text-[0.8125rem] tracking-tight sm:text-base text-good">{formatGBP(totalIncomeAll, { signed: true })}</td>
                    <td className="r num whitespace-nowrap text-[0.8125rem] tracking-tight sm:text-base text-bad">−{formatGBP(totalWageAll)}</td>
                    <td className={`r num whitespace-nowrap text-[0.8125rem] tracking-tight sm:text-base font-bold ${totalIncomeAll - totalWageAll < 0 ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>{formatGBP(totalIncomeAll - totalWageAll)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </TableWrap>
        </Section>
      ) : null}

      {/* Synchronisation: one quiet line when all is well; a warning only when something needs a look. */}
      {(() => {
        const statuses = [sync.dpd, ...(sync.dropbox.tone === "info" && !sync.dropbox.running ? [] : [sync.dropbox])];
        const problems = statuses.filter((x) => x.tone === "warn" || x.tone === "bad");
        const calm = statuses.filter((x) => x.tone !== "warn" && x.tone !== "bad");
        return (
          <Section title="Synchronisation" actions={<LinkButton href="/data" variant="quiet" size="sm">Data &amp; Integrations</LinkButton>}>
            {problems.length > 0 ? (
              <div className="mb-3 grid gap-3 md:grid-cols-2">
                {problems.map((x) => <Notice key={x.key} tone={x.tone} title={x.headline}>{x.detail}</Notice>)}
              </div>
            ) : null}
            <Panel className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                {calm.length > 0 ? calm.map((x) => `${x.headline.replace(/\.$/, "")}${x.running ? "" : x.detail ? ` · ${x.detail.replace(/\.$/, "")}` : ""}`).join(" · ") : "Syncs run automatically each evening."}
              </p>
              {ctx.canWrite ? <SyncButtons dpdRunning={sync.dpd.running} dropboxRunning={sync.dropbox.running} dropboxConnected={sync.dropbox.tone !== "info" || sync.dropbox.running} /> : null}
            </Panel>
          </Section>
        );
      })()}
    </>
  );
}
