import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { franchiseLabel, getContext } from "@/lib/context";
import { loadPeriodData, hiddenFranchiseFilter } from "@/lib/data/period";
import { addDays, formatUkDate, formatUkDateLong, isISODate } from "@/lib/dates";
import { periodContaining, periodFromParam, periodLabel } from "@/lib/finance/periods";
import { PeriodNav } from "@/components/ui/period-nav";
import { DayPicker } from "@/components/ui/day-picker";
import { buildDriverDays, driverIdentity, mergeDriverRows, originalEarnings, summarisePeriod } from "@/lib/finance/calc";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatGBP, sumPence } from "@/lib/money";

export const metadata: Metadata = { title: "Income" };

/** A per-stop or per-parcel rate in pounds (as DPD states it), or "—" when none, or "varies" when the period has more than one. */
function rateLabel(values: Set<string>): string {
  if (values.size === 0) return "—";
  if (values.size > 1) return "Varies";
  const v = [...values][0]!;
  const trimmed = Number(v).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  const [whole, dec = ""] = trimmed.split(".");
  return `£${whole}.${dec.padEnd(2, "0")}`;
}

interface PayPerson {
  key: string;
  name: string;
  driverId: string | null;
  franchises: Set<string>;
  routes: Set<string>;
  stops: number;
  parcels: number;
  excessParcels: number;
  mileage: number;
  total: number;
  stopRates: Set<string>;
  parcelRates: Set<string>;
}

export default async function EarningsPage({ searchParams }: { searchParams: Promise<{ date?: string; period?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const showFranchise = !ctx.franchise && ctx.franchises.length > 1;

  // ── Pay period view ────────────────────────────────────────────────────────────
  if (isISODate(params.period)) {
    const period = periodFromParam(params.period, ctx.today);
    const { start, end } = period;
    const data = await loadPeriodData(ctx.supabase, { accountId: ctx.accountId, from: start, to: end, franchiseId: ctx.franchiseId, hiddenFranchiseIds: ctx.hiddenFranchiseIds });
    const summary = summarisePeriod(data);
    const t = summary.combined;
    const routeIncome = t.earningsMeaning === "route_income";
    // One row per person, even when they work for more than one franchise. The franchises they work for are listed together.
    const perFranchise = summary.franchises.filter((f) => f.franchiseId).flatMap((f) => f.drivers.map((d) => ({ d, franchise: franchiseName.get(f.franchiseId!) ?? "" })));
    const franchisesFor = new Map<string, Set<string>>();
    for (const { d, franchise } of perFranchise) {
      const id = driverIdentity(d.driverId, d.name);
      franchisesFor.set(id, (franchisesFor.get(id) ?? new Set()).add(franchise));
    }
    const routesFor = new Map<string, Set<string>>();
    for (const e of data.earnings.filter((e) => e.date >= start && e.date <= end && e.route)) {
      const id = driverIdentity(e.driverId, e.sourceDriverName);
      routesFor.set(id, (routesFor.get(id) ?? new Set()).add(e.route!));
    }
    // The pay-period driver table: one row per person, with the DPD figures summed across the period.
    const people = new Map<string, PayPerson>();
    for (const e of data.earnings) {
      const id = driverIdentity(e.driverId, e.sourceDriverName);
      const p = people.get(id) ?? { key: id, name: (e.driverId ? data.driverNames.get(e.driverId) : null) ?? e.sourceDriverName, driverId: e.driverId, franchises: new Set<string>(), routes: new Set<string>(), stops: 0, parcels: 0, excessParcels: 0, mileage: 0, total: 0, stopRates: new Set<string>(), parcelRates: new Set<string>() };
      p.franchises.add(franchiseName.get(e.franchiseId) ?? "");
      if (e.route) p.routes.add(e.route);
      p.stops += e.stops ?? 0;
      p.parcels += e.parcels ?? 0;
      p.excessParcels += e.excessParcels ?? 0;
      p.mileage += e.mileage ?? 0;
      p.total += originalEarnings(e);
      if (e.payPerStop != null) p.stopRates.add(e.payPerStop);
      if (e.payPerParcel != null) p.parcelRates.add(e.payPerParcel);
      people.set(id, p);
    }
    const payRows = [...people.values()].sort((a, b) => b.total - a.total);
    const payTotal = payRows.reduce((n, p) => n + p.total, 0);
    const rows = mergeDriverRows(perFranchise.map((x) => x.d)).map((d) => {
      const id = driverIdentity(d.driverId, d.name);
      return {
        ...d,
        franchise: [...(franchisesFor.get(id) ?? new Set())].filter(Boolean).join(", "),
        routes: [...(routesFor.get(id) ?? new Set())].sort((a, b) => a.localeCompare(b, "en-GB", { numeric: true })).join(" / "),
      };
    });
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
                <Stat size="lg" label="Income" value={formatGBP(t.incomeFromDpd)} />
                <Stat label="Stops" value={t.stops.toLocaleString("en-GB")} />
                <Stat label="Parcels" value={t.parcels.toLocaleString("en-GB")} />
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
        {rows.length === 0 && (!routeIncome || data.otherPayments.length === 0) ? <EmptyState title="No Earnings for This Pay Period" /> : routeIncome ? (
          <TableWrap>
            <table className="ledger [&_td]:!px-2 [&_th]:!px-2 sm:[&_td]:!px-3 sm:[&_th]:!px-3">
              <thead>
                <tr>
                  <th>Driver</th><th className="r">Stops</th><th className="r">Parcels</th><th className="r">Excess Parcels</th>
                  <th className="r">Stop Rate</th><th className="r">Excess Parcel Rate</th><th className="r">Total</th><th>Route</th><th className="r">Mileage</th>
                </tr>
              </thead>
              <tbody>
                {payRows.map((p) => (
                  <tr key={p.key}>
                    <td className="font-medium">
                      {p.driverId ? <Link href={`/drivers/${p.driverId}`} className="hover:underline">{p.name}</Link> : <>{p.name} <Badge tone="warn">Not registered</Badge></>}
                      {showFranchise ? <span className="block text-xs font-normal text-muted">{[...p.franchises].filter(Boolean).join(", ")}</span> : null}
                    </td>
                    <td className="r num">{p.stops.toLocaleString("en-GB")}</td>
                    <td className="r num">{p.parcels.toLocaleString("en-GB")}</td>
                    <td className="r num">{p.excessParcels.toLocaleString("en-GB")}</td>
                    <td className="r num">{rateLabel(p.stopRates)}</td>
                    <td className="r num">{rateLabel(p.parcelRates)}</td>
                    <td className="r num font-semibold">{formatGBP(p.total)}</td>
                    <td className="num">{[...p.routes].sort((a, b) => a.localeCompare(b, "en-GB", { numeric: true })).join(" / ") || "—"}</td>
                    <td className="r num">{p.mileage.toLocaleString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="r num">{t.stops.toLocaleString("en-GB")}</td>
                  <td className="r num">{t.parcels.toLocaleString("en-GB")}</td>
                  <td className="r num">{payRows.reduce((n, p) => n + p.excessParcels, 0).toLocaleString("en-GB")}</td>
                  <td /><td />
                  <td className="r num">{formatGBP(payTotal)}</td>
                  <td />
                  <td className="r num">{payRows.reduce((n, p) => n + p.mileage, 0).toLocaleString("en-GB")}</td>
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
                  <tr key={d.key}>
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
    const hiddenFilter = hiddenFranchiseFilter(ctx);
    if (hiddenFilter) q = q.or(hiddenFilter);
    const { data: latest } = await q;
    date = latest?.[0]?.report_date ?? ctx.today;
  }
  const data = await loadPeriodData(ctx.supabase, { accountId: ctx.accountId, from: date, to: date, franchiseId: ctx.franchiseId, hiddenFranchiseIds: ctx.hiddenFranchiseIds });
  const days = buildDriverDays(data.earnings, data.adjustments, data.driverNames).sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  const fileByKey = new Map(data.earnings.map((e) => [`${e.franchiseId}|${e.driverId ?? `unregistered:${e.driverKey}`}`, e]));
  const totalOriginal = sumPence(days.map((d) => d.originalEarnings));
  const totalAdjust = sumPence(days.map((d) => d.adjustmentsNet));
  const routeIncome = data.earningsMeaning === "route_income";
  // One row per person for the day, even when they drove for more than one franchise.
  const dayPeople = (() => {
    const people = new Map<string, { driverId: string | null; name: string; stops: number | null; income: number; routes: Set<string> }>();
    for (const d of days.filter((x) => x.hasReport)) {
      const id = driverIdentity(d.driverId, d.name);
      const p = people.get(id) ?? { driverId: d.driverId, name: d.name, stops: 0, income: 0, routes: new Set<string>() };
      p.stops = p.stops == null || d.stops == null ? null : p.stops + d.stops;
      p.income += d.originalEarnings;
      people.set(id, p);
    }
    for (const e of data.earnings) {
      if (e.route) people.get(driverIdentity(e.driverId, e.sourceDriverName))?.routes.add(e.route);
    }
    return [...people.values()].sort((a, b) => b.income - a.income);
  })();

  return (
    <>
      <PageHeader
        title="Income"
        description={`${formatUkDateLong(date)} · ${ctx.franchise ? franchiseLabel(ctx.franchise) : "All franchises"}`}
        actions={<><LinkButton href={`/earnings?period=${periodContaining(date).start}`} variant="secondary">Pay Period View</LinkButton>{ctx.canWrite ? <LinkButton href={`/adjustments/new?date=${date}`}>Add Pay Adjustment</LinkButton> : null}</>}
      />
      <form method="get" className="mb-6 flex flex-wrap items-center gap-2">
        <DayPicker date={date} max={ctx.today} />
      </form>

      <Section>
        <Panel>
          {routeIncome ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
              <Stat size="lg" label="Income" value={formatGBP(totalOriginal)} />
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
                <th>Driver</th><th>Route</th><th className="r">Stops</th><th className="r">Income</th>
              </tr>
            </thead>
            <tbody>
              {dayPeople.map((p) => (
                <tr key={driverIdentity(p.driverId, p.name)}>
                  <td className="font-medium">{p.driverId ? <Link href={`/drivers/${p.driverId}`} className="hover:underline">{p.name}</Link> : <>{p.name} <Badge tone="warn">Not registered</Badge></>}</td>
                  <td className="num">{[...p.routes].sort((x, y) => x.localeCompare(y, "en-GB", { numeric: true })).join(" / ") || "—"}</td>
                  <td className="r num">{p.stops ?? "—"}</td>
                  <td className="r num font-semibold">{formatGBP(p.income)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td><td />
                <td className="r num">{days.reduce((n, d) => n + (d.stops ?? 0), 0)}</td>
                <td className="r num">{formatGBP(totalOriginal)}</td>
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
