import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { franchiseLabel, getContext } from "@/lib/context";
import { loadPeriodData } from "@/lib/data/period";
import { addDays, formatUkDate, formatUkDateLong, isISODate } from "@/lib/dates";
import { periodContaining, periodFromParam, periodLabel } from "@/lib/finance/periods";
import { PeriodNav } from "@/components/ui/period-nav";
import { buildDriverDays, summarisePeriod } from "@/lib/finance/calc";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatGBP, sumPence } from "@/lib/money";

export const metadata: Metadata = { title: "Income" };

export default async function EarningsPage({ searchParams }: { searchParams: Promise<{ date?: string; period?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const showFranchise = !ctx.franchise && ctx.franchises.length > 1;

  // ── Pay period view ────────────────────────────────────────────────────────────
  if (isISODate(params.period)) {
    const period = periodFromParam(params.period, ctx.today);
    const { start, end } = period;
    const data = await loadPeriodData(ctx.supabase, { accountId: ctx.accountId, from: start, to: end, franchiseId: ctx.franchiseId });
    const summary = summarisePeriod(data);
    const t = summary.combined;
    const routeIncome = t.earningsMeaning === "route_income";
    const rows = summary.franchises.filter((f) => f.franchiseId).flatMap((f) => f.drivers.map((d) => ({ ...d, franchise: franchiseName.get(f.franchiseId!) ?? "" })));
    return (
      <>
        <PageHeader
          title="Income"
          description={`${periodLabel(period)} · ${ctx.franchise ? franchiseLabel(ctx.franchise) : "All franchises"}`}
          actions={<><LinkButton href="/earnings" variant="secondary">Daily View</LinkButton><a className={buttonClass("secondary")} href={`/api/export/drivers?period=${period.start}`}>Download Spreadsheet</a></>}
        />
        <PeriodNav period={period} today={ctx.today} hrefFor={(p) => `/earnings?period=${p}`} />
        <Section>
          <Panel>
            {routeIncome ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
                <Stat size="lg" label="Income" value={formatGBP(t.incomeFromDpd)} sub={t.otherDpdPayments > 0 ? `DPD payments + ${formatGBP(t.otherDpdPayments)} invoice extras` : "From DPD payments"} />
                <Stat label="Wages" value={t.wagesComplete ? formatGBP(t.wages) : `${formatGBP(t.wages)}+`} sub={t.wagesComplete ? "Day rate × days worked" : `${t.driversMissingRate} ${t.driversMissingRate === 1 ? "driver has" : "drivers have"} no day rate`} />
                <Stat label="Drivers working" value={String(t.driverCount)} />
                <Stat label="Stops" value={t.stops.toLocaleString("en-GB")} sub={`${t.parcels.toLocaleString("en-GB")} parcels`} />
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
              <Stat size="lg" label="Driver pay" value={formatGBP(t.driverCosts)} sub="After adjustments" />
              <Stat label="DPD earnings" value={formatGBP(t.driverOriginalEarnings)} sub="As imported" />
              <Stat label="Additional payments" value={formatGBP(t.driverAdditionalPayments)} />
              <Stat label="Deductions" value={formatGBP(t.driverDeductions)} />
            </div>
            )}
          </Panel>
        </Section>
        {rows.length === 0 ? <EmptyState title="No Earnings for This Pay Period" /> : routeIncome ? (
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Driver</th>{showFranchise ? <th className="hidden sm:table-cell">Franchise</th> : null}<th className="r hidden sm:table-cell">Days</th><th className="r hidden sm:table-cell">Stops</th>
                  <th className="r">Income</th><th className="r hidden sm:table-cell">Income / Stop</th><th className="r">Wage</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].filter((d) => d.daysWorked > 0).sort((a, b) => b.originalEarnings - a.originalEarnings).map((d) => (
                  <tr key={`${d.franchiseId}-${d.key}`}>
                    <td className="font-medium">{d.driverId ? <Link href={`/drivers/${d.driverId}`} className="hover:underline">{d.name}</Link> : <>{d.name} <Badge tone="warn">Not registered</Badge></>}</td>
                    {showFranchise ? <td className="hidden sm:table-cell">{d.franchise}</td> : null}
                    <td className="r num hidden sm:table-cell">{d.daysWorked}</td>
                    <td className="r num hidden sm:table-cell">{d.stops.toLocaleString("en-GB")}</td>
                    <td className="r num font-semibold">{formatGBP(d.originalEarnings)}</td>
                    <td className="r num hidden sm:table-cell">{formatGBP(d.earningsPerStop)}</td>
                    <td className="r num">{d.wageComplete && d.wage != null ? formatGBP(d.wage) : <span className="text-muted">No rate</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {/* Invoice lines the daily Payments do not contain, so the total matches what DPD paid. Dated at the period start. */}
                {data.otherPayments.map((o) => (
                  <tr key={o.id}>
                    <td>{o.label} <span className="text-xs font-normal text-muted">invoice {o.invoiceNo}</span></td>{showFranchise ? <td className="hidden sm:table-cell">{franchiseName.get(o.franchiseId) ?? ""}</td> : null}<td className="hidden sm:table-cell" /><td className="hidden sm:table-cell" />
                    <td className="r num">{formatGBP(o.amount)}</td><td className="hidden sm:table-cell" /><td />
                  </tr>
                ))}
                <tr>
                  <td>Total</td>{showFranchise ? <td className="hidden sm:table-cell" /> : null}<td className="hidden sm:table-cell" /><td className="r num hidden sm:table-cell">{t.stops.toLocaleString("en-GB")}</td>
                  <td className="r num">{formatGBP(t.incomeFromDpd)}</td><td className="hidden sm:table-cell" /><td className="r num">{t.wagesComplete ? formatGBP(t.wages) : `${formatGBP(t.wages)}+`}</td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        ) : (
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Driver</th>{showFranchise ? <th>Franchise</th> : null}<th className="r">Days</th><th className="r">Parcels</th><th className="r">Stops</th>
                  <th className="r">Per Stop</th><th className="r">DPD Earnings</th><th className="r">Added</th><th className="r">Deducted</th><th className="r">Final Pay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={`${d.franchiseId}-${d.key}`}>
                    <td className="font-medium">{d.driverId ? <Link href={`/drivers/${d.driverId}`} className="hover:underline">{d.name}</Link> : <>{d.name} <Badge tone="warn">Not registered</Badge></>}</td>
                    {showFranchise ? <td>{d.franchise}</td> : null}
                    <td className="r num">{d.daysWorked}</td>
                    <td className="r num">{d.parcels.toLocaleString("en-GB")}</td>
                    <td className="r num">{d.stops.toLocaleString("en-GB")}</td>
                    <td className="r num">{formatGBP(d.earningsPerStop)}</td>
                    <td className="r num">{formatGBP(d.originalEarnings)}</td>
                    <td className="r num">{d.additionalPayments ? formatGBP(d.additionalPayments, { signed: true }) : "—"}</td>
                    <td className="r num">{d.deductions ? formatGBP(-d.deductions) : "—"}</td>
                    <td className="r num font-semibold">{formatGBP(d.finalEarnings)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>{showFranchise ? <td /> : null}<td /><td className="r num">{t.parcels.toLocaleString("en-GB")}</td><td className="r num">{t.stops.toLocaleString("en-GB")}</td><td />
                  <td className="r num">{formatGBP(t.driverOriginalEarnings)}</td><td className="r num">{formatGBP(t.driverAdditionalPayments, { signed: true })}</td>
                  <td className="r num">{formatGBP(-t.driverDeductions)}</td><td className="r num">{formatGBP(t.driverCosts)}</td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </>
    );
  }

  // ── Day view ──────────────────────────────────────────────────────────────
  let date = isISODate(params.date) ? params.date : null;
  if (!date) {
    let q = ctx.supabase.from("daily_earnings").select("report_date").eq("is_current", true).lte("report_date", ctx.today).order("report_date", { ascending: false }).limit(1);
    if (ctx.franchiseId) q = q.eq("franchise_id", ctx.franchiseId);
    const { data: latest } = await q;
    date = latest?.[0]?.report_date ?? ctx.today;
  }
  const data = await loadPeriodData(ctx.supabase, { accountId: ctx.accountId, from: date, to: date, franchiseId: ctx.franchiseId });
  const days = buildDriverDays(data.earnings, data.adjustments, data.driverNames).sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  const fileByKey = new Map(data.earnings.map((e) => [`${e.franchiseId}|${e.driverId ?? `unregistered:${e.driverKey}`}`, e]));
  const totalOriginal = sumPence(days.map((d) => d.originalEarnings));
  const totalAdjust = sumPence(days.map((d) => d.adjustmentsNet));
  const routeIncome = data.earningsMeaning === "route_income";
  const routesByKey = new Map<string, Set<string>>();
  for (const e of data.earnings) {
    const key = `${e.franchiseId}|${e.driverId ?? `unregistered:${e.driverKey}`}`;
    if (e.route) routesByKey.set(key, (routesByKey.get(key) ?? new Set()).add(e.route));
  }

  return (
    <>
      <PageHeader
        title="Income"
        description={`${formatUkDateLong(date)} · ${ctx.franchise ? franchiseLabel(ctx.franchise) : "All franchises"}`}
        actions={<><LinkButton href={`/earnings?period=${periodContaining(date).start}`} variant="secondary">Pay Period View</LinkButton>{ctx.canWrite ? <LinkButton href={`/adjustments/new?date=${date}`}>Add Pay Adjustment</LinkButton> : null}</>}
      />
      <form method="get" className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={`/earnings?date=${addDays(date, -1)}`} className={buttonClass("secondary", "sm")} aria-label="Previous day"><ChevronLeft className="size-4" aria-hidden /></Link>
        <label className="sr-only" htmlFor="earnings-date">Date</label>
        <input id="earnings-date" type="date" name="date" defaultValue={date} max={ctx.today} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm" />
        <button type="submit" className={buttonClass("secondary", "sm")}>Go</button>
        {date < ctx.today ? <Link href={`/earnings?date=${addDays(date, 1)}`} className={buttonClass("secondary", "sm")} aria-label="Next day"><ChevronRight className="size-4" aria-hidden /></Link> : null}
      </form>

      <Section>
        <Panel>
          {routeIncome ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
              <Stat size="lg" label="Income" value={formatGBP(totalOriginal)} sub="From DPD payments" />
              <Stat label="Drivers working" value={String(days.filter((d) => d.hasReport).length)} />
              <Stat label="Stops" value={days.reduce((n, d) => n + (d.stops ?? 0), 0).toLocaleString("en-GB")} />
              <Stat label="Parcels" value={days.reduce((n, d) => n + (d.parcels ?? 0), 0).toLocaleString("en-GB")} />
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
            <Stat size="lg" label="Driver pay" value={formatGBP(totalOriginal + totalAdjust)} sub="After adjustments" />
            <Stat label="DPD earnings" value={formatGBP(totalOriginal)} sub="As imported" />
            <Stat label="Adjustments" value={totalAdjust === 0 ? "None" : formatGBP(totalAdjust, { signed: true })} />
            <Stat label="Stops" value={days.reduce((n, d) => n + (d.stops ?? 0), 0).toLocaleString("en-GB")} sub={`${days.reduce((n, d) => n + (d.parcels ?? 0), 0).toLocaleString("en-GB")} parcels`} />
          </div>
          )}
        </Panel>
      </Section>

      {days.length === 0 ? (
        <EmptyState title={`No earnings for ${formatUkDate(date)}`} action={<LinkButton href="/data" variant="secondary">Go to Data &amp; Integrations</LinkButton>}>
          No DPD report has been imported for this day. Sync DPD, or upload the report by hand.
        </EmptyState>
      ) : routeIncome ? (
        <TableWrap>
          <table className="ledger">
            <thead>
              <tr>
                <th>Driver</th>{showFranchise ? <th className="hidden sm:table-cell">Franchise</th> : null}<th>Route</th><th className="r hidden sm:table-cell">Stops</th><th className="r hidden sm:table-cell">Parcels</th><th className="r">Income</th><th className="hidden sm:table-cell">Source</th>
              </tr>
            </thead>
            <tbody>
              {days.filter((d) => d.hasReport).map((d) => {
                const key = `${d.franchiseId}|${d.key}`;
                const source = fileByKey.get(key);
                return (
                  <tr key={`${d.franchiseId}-${d.key}`}>
                    <td className="font-medium">{d.driverId ? <Link href={`/drivers/${d.driverId}`} className="hover:underline">{d.name}</Link> : <>{d.name} <Badge tone="warn">Not registered</Badge></>}</td>
                    {showFranchise ? <td className="hidden sm:table-cell">{franchiseName.get(d.franchiseId) ?? ""}</td> : null}
                    <td className="num">{[...(routesByKey.get(key) ?? [])].join(" / ") || "—"}</td>
                    <td className="r num hidden sm:table-cell">{d.stops ?? "—"}</td>
                    <td className="r num hidden sm:table-cell">{d.parcels ?? "—"}</td>
                    <td className="r num font-semibold">{formatGBP(d.originalEarnings)}</td>
                    <td className="text-sm hidden sm:table-cell">{source ? <a href={`/api/files/${source.importedFileId}`} className="text-accent hover:underline">{SOURCE_LABEL[source.source] ?? "Document"}</a> : <span className="text-muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>{showFranchise ? <td className="hidden sm:table-cell" /> : null}<td /><td className="r num hidden sm:table-cell">{days.reduce((n, d) => n + (d.stops ?? 0), 0)}</td><td className="r num hidden sm:table-cell">{days.reduce((n, d) => n + (d.parcels ?? 0), 0)}</td>
                <td className="r num">{formatGBP(totalOriginal)}</td><td className="hidden sm:table-cell" />
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      ) : (
        <TableWrap>
          <table className="ledger">
            <thead>
              <tr>
                <th>Driver</th>{showFranchise ? <th>Franchise</th> : null}<th className="r">Parcels</th><th className="r">Stops</th><th className="r">Gross</th>
                <th className="r">DPD Deductions</th><th className="r">DPD Extras</th><th className="r">DPD Earnings</th><th className="r">Adjustments</th><th className="r">Final Pay</th><th>Source</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const source = fileByKey.get(`${d.franchiseId}|${d.key}`);
                return (
                  <tr key={`${d.franchiseId}-${d.key}`}>
                    <td className="font-medium">{d.driverId ? <Link href={`/drivers/${d.driverId}`} className="hover:underline">{d.name}</Link> : <>{d.name} <Badge tone="warn">Not registered</Badge></>}</td>
                    {showFranchise ? <td>{franchiseName.get(d.franchiseId) ?? ""}</td> : null}
                    <td className="r num">{d.parcels ?? "—"}</td>
                    <td className="r num">{d.stops ?? "—"}</td>
                    <td className="r num">{d.hasReport ? formatGBP(d.gross) : "—"}</td>
                    <td className="r num">{d.dpdDeductions ? formatGBP(-d.dpdDeductions) : "—"}</td>
                    <td className="r num">{d.dpdAdditional ? formatGBP(d.dpdAdditional, { signed: true }) : "—"}</td>
                    <td className="r num">{d.hasReport ? formatGBP(d.originalEarnings) : <span className="text-muted">No report</span>}</td>
                    <td className="r num">{d.adjustmentCount === 0 ? "—" : formatGBP(d.adjustmentsNet, { signed: true })}</td>
                    <td className="r num font-semibold">{formatGBP(d.finalEarnings)}</td>
                    <td className="text-sm">{source ? <a href={`/api/files/${source.importedFileId}`} className="text-accent hover:underline">{SOURCE_LABEL[source.source] ?? "Document"}</a> : <span className="text-muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>{showFranchise ? <td /> : null}<td className="r num">{days.reduce((n, d) => n + (d.parcels ?? 0), 0)}</td><td className="r num">{days.reduce((n, d) => n + (d.stops ?? 0), 0)}</td>
                <td className="r num">{formatGBP(sumPence(days.map((d) => d.gross)))}</td><td /><td />
                <td className="r num">{formatGBP(totalOriginal)}</td><td className="r num">{totalAdjust === 0 ? "—" : formatGBP(totalAdjust, { signed: true })}</td>
                <td className="r num">{formatGBP(totalOriginal + totalAdjust)}</td><td />
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      )}
    </>
  );
}
