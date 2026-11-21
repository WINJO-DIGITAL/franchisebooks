/**
 * Builds the data for a monthly report. The same structure feeds the on-screen
 * report, the PDF and the CSV exports, so they can never disagree.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/data/fetch-all";
import { loadPeriodData, type AdjustmentDetail } from "@/lib/data/period";
import { addDays, addMonths, monthRange, type ISODate, type YearMonth } from "@/lib/dates";
import type { DpdPeriod } from "@/lib/finance/periods";
import { summariseCosts } from "@/lib/finance/cost-summary";
import type { Pence } from "@/lib/money";
import {
  combineFranchises, comparePerformance, summarisePeriod,
  type CategoryTotal, type DriverSummary, type FranchiseSummary, type PerformanceComparison,
} from "@/lib/finance/calc";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/** One driver's day as DPD shows it on the Payments page. */
export interface ReportDailyPayment {
  date: ISODate;
  driverName: string;
  franchiseLabel: string;
  route: string | null;
  stops: number | null;
  parcels: number | null;
  excessParcels: number | null;
  stopPay: Pence | null;
  parcelPay: Pence | null;
  total: Pence;
  mileage: number | null;
}

export interface ReportDriver extends DriverSummary {
  franchiseLabel: string;
  comparison: PerformanceComparison;
  /** Route numbers the driver ran in the period. Shown separated by " / " so they never read as one large number. */
  routes: string[];
}

export interface ReportAdjustment {
  id: string;
  date: ISODate;
  driverName: string;
  franchiseLabel: string;
  type: string;
  amount: number;
  reason: string;
  isReversal: boolean;
  isReversed: boolean;
  fromCover: boolean;
}

export interface ReportAlert {
  id: string;
  date: ISODate;
  type: string;
  title: string;
  status: string;
  actual: string | null;
  expected: string | null;
}

export interface MonthlyReport {
  accountName: string;
  month: YearMonth;
  /** Set for a four-week period report; null for a calendar month. */
  period: DpdPeriod | null;
  from: ISODate;
  to: ISODate;
  /** Null for the consolidated all-franchise report. */
  franchiseId: string | null;
  scopeLabel: string;
  generatedAt: string;
  totals: FranchiseSummary;
  franchises: (FranchiseSummary & { label: string; vatOnCosts: Pence })[];
  /** VAT on fuel and other costs, as the expense documents state it. Wages carry no VAT. */
  vatOnCosts: Pence;
  drivers: ReportDriver[];
  /** Every driver-day in the period, for the day-by-day section. Optional so older reports still render. */
  dailyPayments?: ReportDailyPayment[];
  /** DPD payments outside the daily Payments (Fuel Supplement, C&D App, one-off support payments). Optional for older reports. */
  otherPayments?: { label: string; amount: number; vat?: number; invoiceNo: string }[];
  categories: CategoryTotal[];
  adjustments: ReportAdjustment[];
  unusual: ReportAlert[];
  missingData: ReportAlert[];
  unresolvedImports: { id: string; title: string; createdAt: string }[];
  coverCount: number;
  revenueAllocationBasis: string;
}

const MISSING_TYPES = new Set(["missing_driver_report", "missing_franchise_report", "missing_fuel", "unregistered_driver", "source_conflict"]);

export async function buildMonthlyReport(db: Db, input: { accountId: string; month: YearMonth; franchiseId: string | null; period?: DpdPeriod | null }): Promise<MonthlyReport> {
  const { accountId, month, franchiseId } = input;
  const period = input.period ?? null;
  const { start, end } = period ?? monthRange(month);
  // The "usual" a driver is compared with: the previous three months, or the previous three four-week periods.
  const baselineFrom = period ? addDays(period.start, -84) : monthRange(addMonths(month, -3)).start;
  const baselineTo = period ? addDays(period.start, -1) : monthRange(addMonths(month, -1)).end;

  const [account, franchises, data, baselineData, anomalies, reviews] = await Promise.all([
    db.from("accounts").select("name").eq("id", accountId).maybeSingle(),
    fetchAll(() => db.from("franchises").select("id, fd_number, name").eq("account_id", accountId).order("fd_number")),
    loadPeriodData(db, { accountId, from: start, to: end, franchiseId }),
    loadPeriodData(db, { accountId, from: baselineFrom, to: baselineTo, franchiseId }),
    fetchAll(() => {
      let q = db.from("anomalies").select("id, subject_date, anomaly_type, title, status, actual_value, expected_value, franchise_id")
        .eq("account_id", accountId).gte("subject_date", start).lte("subject_date", end).order("subject_date").order("id");
      if (franchiseId) q = q.eq("franchise_id", franchiseId);
      return q;
    }),
    fetchAll(() => {
      let q = db.from("review_items").select("id, title, created_at, franchise_id").eq("account_id", accountId).eq("status", "open").order("created_at").order("id");
      if (franchiseId) q = q.eq("franchise_id", franchiseId);
      return q;
    }),
  ]);

  const label = new Map(franchises.map((f) => [f.id, f.name && f.name !== f.fd_number ? `${f.fd_number} · ${f.name}` : f.fd_number]));
  const routesByDriver = new Map<string, Set<string>>();
  for (const e of data.earnings) {
    if (!e.route) continue;
    const k = `${e.franchiseId}|${e.driverId ?? `unregistered:${e.driverKey}`}`;
    routesByDriver.set(k, (routesByDriver.get(k) ?? new Set()).add(e.route));
  }
  const summary = summarisePeriod(data);
  const baseline = summarisePeriod(baselineData);
  const scoped = franchiseId ? summary.franchises.filter((f) => f.franchiseId === franchiseId) : summary.franchises;
  const totals = franchiseId ? (scoped[0] ?? combineFranchises([])) : summary.combined;
  if (franchiseId && !scoped[0]) totals.franchiseId = franchiseId;

  const baselineByKey = new Map(baseline.franchises.flatMap((f) => f.drivers.map((d) => [`${f.franchiseId}|${d.key}`, d] as const)));
  const drivers: ReportDriver[] = scoped
    .filter((f) => f.franchiseId)
    .flatMap((f) => f.drivers.map((d) => ({
      ...d,
      franchiseLabel: label.get(f.franchiseId!) ?? "",
      comparison: comparePerformance(d, baselineByKey.get(`${f.franchiseId}|${d.key}`) ?? null),
      routes: [...(routesByDriver.get(`${f.franchiseId}|${d.key}`) ?? [])].sort((a, b) => a.localeCompare(b, "en-GB", { numeric: true })),
    })))
    .sort((a, b) => a.franchiseLabel.localeCompare(b.franchiseLabel) || a.name.localeCompare(b.name, "en-GB"));

  const dailyPayments: ReportDailyPayment[] = data.earnings
    .map((e) => ({
      date: e.date,
      driverName: (e.driverId ? data.driverNames.get(e.driverId) : null) ?? e.sourceDriverName,
      franchiseLabel: label.get(e.franchiseId) ?? "",
      route: e.route,
      stops: e.stops,
      parcels: e.parcels,
      excessParcels: e.excessParcels ?? null,
      stopPay: e.stopPay ?? null,
      parcelPay: e.parcelPay ?? null,
      total: e.gross,
      mileage: e.mileage ?? null,
    }))
    .sort((a, b) => a.franchiseLabel.localeCompare(b.franchiseLabel) || a.driverName.localeCompare(b.driverName, "en-GB") || a.date.localeCompare(b.date));

  const reversed = new Set(data.adjustments.filter((a) => a.reversesId).map((a) => a.reversesId as string));
  const adjustments: ReportAdjustment[] = (data.adjustments as AdjustmentDetail[])
    .map((a) => ({
      id: a.id, date: a.date, driverName: data.driverNames.get(a.driverId) ?? "Unknown driver", franchiseLabel: label.get(a.franchiseId) ?? "",
      type: a.type, amount: a.amount, reason: a.reason, isReversal: a.reversesId != null, isReversed: reversed.has(a.id), fromCover: a.coverRecordId != null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.driverName.localeCompare(b.driverName));

  const toAlert = (a: (typeof anomalies)[number]): ReportAlert => ({
    id: a.id, date: a.subject_date, type: a.anomaly_type, title: a.title, status: a.status, actual: a.actual_value, expected: a.expected_value,
  });
  const relevant = anomalies.filter((a) => a.status !== "ignored");

  return {
    accountName: account.data?.name ?? "",
    month,
    period,
    from: start,
    to: end,
    franchiseId,
    scopeLabel: franchiseId ? (label.get(franchiseId) ?? "Franchise") : "All franchises (consolidated)",
    generatedAt: new Date().toISOString(),
    totals,
    franchises: scoped.filter((f) => f.franchiseId).map((f) => ({ ...f, label: label.get(f.franchiseId!) ?? "", vatOnCosts: summariseCosts(data.costs.filter((c) => c.franchiseId === f.franchiseId)).vat })),
    vatOnCosts: summariseCosts(data.costs).vat,
    drivers,
    dailyPayments,
    otherPayments: data.otherPayments.map((o) => ({ label: o.label, amount: o.amount, ...(o.vat ? { vat: o.vat } : {}), invoiceNo: o.invoiceNo })),
    categories: totals.categories,
    adjustments,
    unusual: relevant.filter((a) => !MISSING_TYPES.has(a.anomaly_type)).map(toAlert),
    missingData: relevant.filter((a) => MISSING_TYPES.has(a.anomaly_type) && a.status !== "resolved").map(toAlert),
    unresolvedImports: reviews.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at })),
    coverCount: data.covers.filter((c) => c.status === "active").length,
    revenueAllocationBasis: data.revenueAllocationBasis,
  };
}

export function changeText(change: number | null): string {
  if (change == null) return "No history";
  if (change === 0) return "Same as usual";
  return `${change > 0 ? "+" : "-"}${Math.abs(change)}%`;
}
