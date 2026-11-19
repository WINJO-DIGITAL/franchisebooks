/**
 * Anomaly detection.
 *
 * Pure functions: rows in, explainable alerts out. Detection never changes
 * any data — an alert is only ever a prompt for the owner to look at something.
 *
 * Every alert says what happened, the actual figure, the normal comparison
 * figure, why it was flagged and what the owner might do about it. Drivers
 * are always compared with their own history, never with each other, and the
 * wording describes the figures rather than judging the driver.
 */

import {
  addDays, formatUkDate, formatUkDateLong, weekdayName, weekdayOf, weekStart, type ISODate,
} from "@/lib/dates";
import { originalEarnings, type CoverRow, type EarningRow } from "@/lib/finance/calc";
import { formatGBP, type Pence } from "@/lib/money";

// ── Configuration ───────────────────────────────────────────────────────────

export interface AnomalyConfig {
  /** How many of the driver's previous working days form "normal". */
  baselineDays: number;
  /** Below this many previous working days no comparison is made. */
  minBaselineDays: number;
  earningsChangePct: number;
  earningsMinDiffPence: Pence;
  stopsChangePct: number;
  stopsMinDiff: number;
  parcelsChangePct: number;
  parcelsMinDiff: number;
  fuelWeeklyChangePct: number;
  fuelMinDiffPence: Pence;
  fuelBaselineWeeks: number;
  expenseHighMultiple: number;
  expenseMinPence: Pence;
  dpdDeductionMinPence: Pence;
  stopVariationPct: number;
  missingReportLookbackWeeks: number;
  missingReportMinHits: number;
  /** A driver's stops over the last 7 days this far below their own previous 4 weeks (like days compared with like days). */
  sustainedDropPct: number;
  /** A franchise's income per stop this far below its previous 4 weeks. */
  yieldDropPct: number;
  /** DPD charges this far above the previous period's. */
  chargesRisePct: number;
  chargesRiseMinPence: Pence;
  /** An invoice whose stop pay differs from the daily payments by more than this. */
  invoiceTolerancePence: Pence;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  baselineDays: 20,
  minBaselineDays: 5,
  earningsChangePct: 30,
  earningsMinDiffPence: 2000,
  stopsChangePct: 25,
  stopsMinDiff: 10,
  parcelsChangePct: 35,
  parcelsMinDiff: 15,
  fuelWeeklyChangePct: 40,
  fuelMinDiffPence: 3000,
  fuelBaselineWeeks: 6,
  expenseHighMultiple: 2.5,
  expenseMinPence: 10000,
  dpdDeductionMinPence: 2500,
  stopVariationPct: 35,
  missingReportLookbackWeeks: 4,
  missingReportMinHits: 3,
  sustainedDropPct: 20,
  yieldDropPct: 10,
  chargesRisePct: 15,
  chargesRiseMinPence: 2000,
  invoiceTolerancePence: 500,
};

/** Merges owner overrides over the defaults, ignoring anything that is not a sensible number. */
export function resolveAnomalyConfig(overrides: unknown): AnomalyConfig {
  const config = { ...DEFAULT_ANOMALY_CONFIG };
  if (overrides && typeof overrides === "object") {
    for (const key of Object.keys(config) as (keyof AnomalyConfig)[]) {
      const value = (overrides as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value) && value > 0) config[key] = value;
    }
  }
  return config;
}

// ── Inputs and outputs ──────────────────────────────────────────────────────

export interface AnomalyEarning extends EarningRow {
  payPerParcel: string | null;
  payPerStop: string | null;
}

export interface AnomalyCost {
  id: string;
  kind: "fuel" | "expense";
  isFuel: boolean;
  franchiseId: string | null;
  driverId: string | null;
  date: ISODate;
  amount: Pence;
  categoryId: string | null;
  categoryName: string;
  supplier: string | null;
  vehicleRegistration: string | null;
  reference: string | null;
  /** True for charges DPD itself raised (they repeat by design, so are not duplicate-checked). */
  fromDpd?: boolean;
  /** True when a cost has not been assigned to a driver or the franchise. */
  unassigned?: boolean;
}

/** A stored DPD self-billed invoice, with its stop-pay lines already totalled. */
export interface AnomalyInvoice {
  id: string;
  franchiseId: string;
  invoiceNo: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  reconciled: boolean;
  /** Pence, excluding VAT: the invoice lines that the daily Payments already contain. */
  stopPayNet: Pence;
  /** The day the invoice was stored. */
  storedOn: ISODate;
}

export interface AnomalyInput {
  /** Inclusive range of dates to evaluate. History before evalFrom is used for comparison only. */
  evalFrom: ISODate;
  evalTo: ISODate;
  /** Reports are expected to have arrived for every date up to and including this one. */
  reportsExpectedThrough: ISODate;
  config: AnomalyConfig;
  franchises: { id: string; fdNumber: string; name: string }[];
  drivers: { id: string; name: string; isActive: boolean; startDate: ISODate | null; leavingDate: ISODate | null }[];
  assignments: { driverId: string; franchiseId: string; startDate: ISODate; endDate: ISODate | null }[];
  earnings: AnomalyEarning[];
  costs: AnomalyCost[];
  covers: CoverRow[];
  openConflicts: { id: string; franchiseId: string | null; title: string; detail: string; date: ISODate }[];
  invoices?: AnomalyInvoice[];
  /**
   * For each franchise, the first and last day we hold daily payments for. An invoice is only compared with the daily payments
   * for periods this covers: for earlier days there is no data to compare, which is not the same as nothing having been earned.
   */
  dailyCoverage?: Record<string, { first: ISODate; last: ISODate }>;
}

export type AnomalyType =
  | "earnings_low" | "earnings_high" | "stops_low" | "stops_high" | "parcels_low" | "parcels_high"
  | "missing_driver_report" | "missing_franchise_report" | "unregistered_driver"
  | "pay_rate_changed" | "dpd_deduction_unusual" | "stops_inconsistent"
  | "fuel_high" | "missing_fuel" | "duplicate_cost" | "expense_high" | "source_conflict"
  | "sustained_drop" | "yield_low" | "charges_spike" | "invoice_mismatch" | "invoice_unreadable" | "cost_unassigned";

export type Severity = "info" | "attention" | "urgent";

export interface AnomalyCandidate {
  dedupeKey: string;
  type: AnomalyType;
  severity: Severity;
  franchiseId: string | null;
  driverId: string | null;
  subjectDate: ISODate;
  title: string;
  whatHappened: string;
  actualValue: string | null;
  expectedValue: string | null;
  whyFlagged: string;
  suggestedAction: string;
  metric: Record<string, unknown>;
}

// ── Statistics ──────────────────────────────────────────────────────────────

export interface Baseline {
  n: number;
  mean: number;
  stdev: number;
  low: number;
  high: number;
}

/**
 * The driver's "normal" for a figure: the average of their previous working
 * days, with a usual range of ± the configured percentage (widened for
 * drivers whose figures naturally vary more from day to day).
 */
export function baselineOf(values: number[], changePct: number, minN: number): Baseline | null {
  if (values.length < minN) return null;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const spread = Math.max((Math.abs(mean) * changePct) / 100, 1.5 * stdev);
  return { n, mean, stdev, low: mean - spread, high: mean + spread };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function pct(actual: number, mean: number): number {
  return mean === 0 ? 0 : Math.round(((actual - mean) / Math.abs(mean)) * 1000) / 10;
}

function pctText(change: number): string {
  return `${Math.abs(change)}% ${change < 0 ? "below" : "above"}`;
}

// ── Stop consistency ────────────────────────────────────────────────────────

export type StopConsistency = "normal" | "unusual" | "missing" | "discrepancy" | "no_history";

export const STOP_CONSISTENCY_LABEL: Record<StopConsistency, string> = {
  normal: "Normal variation",
  unusual: "Unusual variation",
  missing: "Missing information",
  discrepancy: "Confirmed discrepancy",
  no_history: "Not enough history yet",
};

/**
 * Classifies one day's stops against the driver's own baseline.
 * "discrepancy" is reserved for days where two source documents disagree —
 * it is never inferred statistically.
 */
export function classifyStops(
  stops: number | null,
  baseline: Baseline | null,
  options: { hasSourceConflict?: boolean; minDiff?: number } = {},
): StopConsistency {
  if (options.hasSourceConflict) return "discrepancy";
  if (stops == null) return "missing";
  if (!baseline) return "no_history";
  const diff = Math.abs(stops - baseline.mean);
  if ((stops < baseline.low || stops > baseline.high) && diff >= (options.minDiff ?? 0)) return "unusual";
  return "normal";
}

// ── Detection ───────────────────────────────────────────────────────────────

interface DriverDayFigures {
  date: ISODate;
  earnings: Pence;
  stops: number | null;
  parcels: number | null;
  deductions: Pence;
  payPerParcel: string | null;
  payPerStop: string | null;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function detectAnomalies(input: AnomalyInput): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];
  const { config } = input;
  const franchiseLabel = new Map(input.franchises.map((f) => [f.id, f.name ? `${f.fdNumber} (${f.name})` : f.fdNumber]));
  const driverName = new Map(input.drivers.map((d) => [d.id, d.name]));
  const inEval = (date: ISODate) => date >= input.evalFrom && date <= input.evalTo;
  const label = (franchiseId: string | null) => (franchiseId ? (franchiseLabel.get(franchiseId) ?? "this franchise") : "your business");

  // ── Per driver, per franchise day-by-day comparison ───────────────────────
  const byDriver = groupBy(input.earnings, (e) => `${e.franchiseId}|${e.driverId ?? `unregistered:${e.driverKey}`}`);
  for (const [groupKey, rows] of byDriver) {
    const first = rows[0]!;
    const franchiseId = first.franchiseId;
    const driverId = first.driverId;
    const name = driverId ? (driverName.get(driverId) ?? first.sourceDriverName) : first.sourceDriverName;

    // Collapse to one set of figures per day.
    const dayMap = new Map<ISODate, DriverDayFigures>();
    for (const e of rows) {
      const day = dayMap.get(e.date);
      if (day) {
        day.earnings += originalEarnings(e);
        day.stops = day.stops == null || e.stops == null ? null : day.stops + e.stops;
        day.parcels = day.parcels == null || e.parcels == null ? null : day.parcels + e.parcels;
        day.deductions += e.deductions;
      } else {
        dayMap.set(e.date, {
          date: e.date, earnings: originalEarnings(e), stops: e.stops, parcels: e.parcels,
          deductions: e.deductions, payPerParcel: e.payPerParcel, payPerStop: e.payPerStop,
        });
      }
    }
    const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    if (driverId == null) {
      const latest = days[days.length - 1]!;
      if (days.some((d) => inEval(d.date))) {
        out.push({
          dedupeKey: `unregistered_driver|${franchiseId}|${first.driverKey}`,
          type: "unregistered_driver",
          severity: "attention",
          franchiseId,
          driverId: null,
          subjectDate: latest.date,
          title: `"${name}" appears in DPD reports but is not registered`,
          whatHappened: `${name} appears in the earnings reports for ${label(franchiseId)} on ${days.length} day${days.length === 1 ? "" : "s"}, most recently ${formatUkDateLong(latest.date)}, but there is no matching driver in your driver list.`,
          actualValue: `${days.length} report day${days.length === 1 ? "" : "s"}`,
          expectedValue: "A registered driver",
          whyFlagged: "The name (or DPD driver reference) on the report does not match any registered driver, so these earnings cannot be attributed to a person yet.",
          suggestedAction: "Add this person as a driver, or link the name to an existing driver if it is a different spelling.",
          metric: { driverKey: first.driverKey, days: days.length },
        });
      }
      continue;
    }

    for (let i = 0; i < days.length; i++) {
      const day = days[i]!;
      if (!inEval(day.date)) continue;
      const history = days.slice(Math.max(0, i - config.baselineDays), i);
      const basisText = `their previous ${history.length} working days`;

      // Pay rate changes
      const previous = history[history.length - 1];
      if (previous) {
        const rateChecks = [
          { now: day.payPerParcel, before: previous.payPerParcel, noun: "pay per parcel" },
          { now: day.payPerStop, before: previous.payPerStop, noun: "pay per stop" },
        ];
        for (const rate of rateChecks) {
          if (rate.now != null && rate.before != null && Number(rate.now) !== Number(rate.before)) {
            out.push({
              dedupeKey: `rate|${rate.noun}|${groupKey}|${day.date}`,
              type: "pay_rate_changed",
              severity: "attention",
              franchiseId,
              driverId,
              subjectDate: day.date,
              title: `${name}: ${rate.noun} changed on ${formatUkDate(day.date)}`,
              whatHappened: `The DPD report for ${formatUkDateLong(day.date)} shows ${rate.noun} of £${Number(rate.now).toFixed(4)} for ${name}. On ${formatUkDate(previous.date)} it was £${Number(rate.before).toFixed(4)}.`,
              actualValue: `£${Number(rate.now).toFixed(4)}`,
              expectedValue: `£${Number(rate.before).toFixed(4)}`,
              whyFlagged: "The rate on this report is different from the rate on the driver's previous report.",
              suggestedAction: "Confirm that the rate change is expected (for example a new route or a DPD rate review).",
              metric: { now: rate.now, before: rate.before, previousDate: previous.date },
            });
          }
        }
      }

      // Unusual DPD deduction
      if (day.deductions >= config.dpdDeductionMinPence && history.length >= config.minBaselineDays) {
        const usual = history.reduce((a, h) => a + h.deductions, 0) / history.length;
        if (day.deductions > usual * 2) {
          out.push({
            dedupeKey: `dpd_deduction|${groupKey}|${day.date}`,
            type: "dpd_deduction_unusual",
            severity: "attention",
            franchiseId,
            driverId,
            subjectDate: day.date,
            title: `${name}: unusual DPD deduction on ${formatUkDate(day.date)}`,
            whatHappened: `The DPD report for ${formatUkDateLong(day.date)} includes deductions of ${formatGBP(day.deductions)} for ${name}.`,
            actualValue: formatGBP(day.deductions),
            expectedValue: `${formatGBP(Math.round(usual))} on a typical day`,
            whyFlagged: `Deductions on this driver's reports average ${formatGBP(Math.round(usual))} a day over ${basisText}; this is more than double that.`,
            suggestedAction: "Open the original DPD document to see what the deduction is for.",
            metric: { actual: day.deductions, usual: Math.round(usual) },
          });
        }
      }
    }

    // Sustained drop in stops: the last 7 days against the driver's own previous 4 weeks, like days with like days
    // (Sundays with Sundays), so a single short day or a different day mix never raises it.
    {
      const recentFrom = addDays(input.evalTo, -6);
      const baseFrom = addDays(recentFrom, -28);
      const dayType = (date: ISODate) => (weekdayOf(date) === 0 ? "sun" : weekdayOf(date) === 6 ? "sat" : "wk");
      const withStops = days.filter((d) => d.stops != null);
      const baseDays = withStops.filter((d) => d.date >= baseFrom && d.date < recentFrom);
      const recentDays = withStops.filter((d) => d.date >= recentFrom && d.date <= input.evalTo);
      if (baseDays.length >= 8 && recentDays.length >= 3) {
        const meanByType = new Map<string, number>();
        for (const type of ["sun", "sat", "wk"]) {
          const of = baseDays.filter((d) => dayType(d.date) === type);
          if (of.length >= 3) meanByType.set(type, of.reduce((a, d) => a + (d.stops as number), 0) / of.length);
        }
        let expected = 0;
        let actual = 0;
        let counted = 0;
        for (const d of recentDays) {
          const usual = meanByType.get(dayType(d.date));
          if (usual == null) continue;
          expected += usual;
          actual += d.stops as number;
          counted++;
        }
        const dropPct = expected > 0 ? Math.round(((expected - actual) / expected) * 1000) / 10 : 0;
        if (counted >= 3 && dropPct >= config.sustainedDropPct && (expected - actual) / counted >= config.stopsMinDiff) {
          out.push({
            dedupeKey: `sustained_drop|${groupKey}|${weekStart(input.evalTo)}`,
            type: "sustained_drop",
            severity: dropPct >= 40 ? "urgent" : "attention",
            franchiseId,
            driverId,
            subjectDate: recentDays[recentDays.length - 1]!.date,
            title: `${name}: stops down ${dropPct}% over the last 7 days`,
            whatHappened: `${name} completed ${actual} stops over ${counted} working days in the last 7 days in ${label(franchiseId)}. On comparable days over the previous 4 weeks that would have been about ${Math.round(expected)}.`,
            actualValue: `${Math.round(actual / counted)} stops a day`,
            expectedValue: `${Math.round(expected / counted)} stops a day`,
            whyFlagged: `Stops are ${dropPct}% below this driver's own previous 4 weeks, comparing Sundays with Sundays, Saturdays with Saturdays and weekdays with weekdays. It is a pattern across the week, not one short day.`,
            suggestedAction: "Check whether the route, hours or area changed, or whether work is missing from the DPD reports.",
            metric: { actual, expected: Math.round(expected), dropPct, days: counted },
          });
        }
      }
    }
  }

  // The days each franchise has reports for (used to tell which weeks a franchise operated).
  // A missing day, or a driver absent from a day, is deliberately NOT an alert: the portal is the source of truth,
  // so a day with no rows is a day with no work. A failed or stale sync is reported separately on the dashboard.
  const reportDatesByFranchise = new Map<string, Set<ISODate>>();
  for (const e of input.earnings) {
    if (!reportDatesByFranchise.has(e.franchiseId)) reportDatesByFranchise.set(e.franchiseId, new Set());
    reportDatesByFranchise.get(e.franchiseId)!.add(e.date);
  }

  // ── Income per stop (yield) ───────────────────────────────────────────────
  {
    const recentFrom = addDays(input.evalTo, -6);
    const baseFrom = addDays(recentFrom, -28);
    for (const franchise of input.franchises) {
      let recentIncome = 0, recentStops = 0, baseIncome = 0, baseStops = 0;
      for (const e of input.earnings) {
        if (e.franchiseId !== franchise.id || e.stops == null) continue;
        if (e.date >= recentFrom && e.date <= input.evalTo) { recentIncome += originalEarnings(e); recentStops += e.stops; }
        else if (e.date >= baseFrom && e.date < recentFrom) { baseIncome += originalEarnings(e); baseStops += e.stops; }
      }
      if (recentStops < 100 || baseStops < 300) continue;
      const recentYield = recentIncome / recentStops;
      const baseYield = baseIncome / baseStops;
      const dropPct = Math.round(((baseYield - recentYield) / baseYield) * 1000) / 10;
      if (dropPct >= config.yieldDropPct) {
        out.push({
          dedupeKey: `yield_low|${franchise.id}|${weekStart(input.evalTo)}`,
          type: "yield_low",
          severity: "attention",
          franchiseId: franchise.id,
          driverId: null,
          subjectDate: input.evalTo,
          title: `${franchise.fdNumber}: income per stop down ${dropPct}%`,
          whatHappened: `${label(franchise.id)} earned ${formatGBP(Math.round(recentYield))} per stop over the last 7 days, against ${formatGBP(Math.round(baseYield))} over the previous 4 weeks.`,
          actualValue: `${formatGBP(Math.round(recentYield))} per stop`,
          expectedValue: `${formatGBP(Math.round(baseYield))} per stop`,
          whyFlagged: `Income per stop is ${dropPct}% below the franchise's previous 4 weeks. That usually means a rate change, a different mix of work, or fewer higher-paying stops.`,
          suggestedAction: "Compare this week's payments with last month's on the Earnings page, and check DPD has not changed a rate.",
          metric: { recentYield: Math.round(recentYield), baseYield: Math.round(baseYield), dropPct, recentStops, baseStops },
        });
      }
    }
  }

  // ── DPD charges rising ────────────────────────────────────────────────────
  {
    const chargeCosts = input.costs.filter((c) => !c.isFuel && /dpd/i.test(c.categoryName));
    const byFranchise = groupBy(chargeCosts, (c) => c.franchiseId ?? "none");
    for (const [franchiseId, items] of byFranchise) {
      if (franchiseId === "none") continue;
      const totals = new Map<ISODate, Pence>();
      for (const c of items) totals.set(c.date, (totals.get(c.date) ?? 0) + c.amount);
      const dates = [...totals.keys()].sort();
      for (let i = 1; i < dates.length; i++) {
        const date = dates[i]!;
        if (!inEval(date)) continue;
        const total = totals.get(date)!;
        const previous = totals.get(dates[i - 1]!)!;
        if (previous <= 0) continue;
        const risePct = pct(total, previous);
        if (risePct >= config.chargesRisePct && total - previous >= config.chargesRiseMinPence) {
          out.push({
            dedupeKey: `charges_spike|${franchiseId}|${date}`,
            type: "charges_spike",
            severity: "attention",
            franchiseId,
            driverId: null,
            subjectDate: date,
            title: `${label(franchiseId)}: DPD charges up ${risePct}% on last period`,
            whatHappened: `DPD charged ${label(franchiseId)} ${formatGBP(total)} for the period starting ${formatUkDateLong(date)}, against ${formatGBP(previous)} the period before.`,
            actualValue: formatGBP(total),
            expectedValue: formatGBP(previous),
            whyFlagged: `The charges are ${risePct}% (${formatGBP(total - previous)}) higher than the previous period.`,
            suggestedAction: "Open the Charges breakdown for this period and look for a new or larger line.",
            metric: { total, previous, risePct },
          });
        }
      }
    }
  }

  // ── Invoices that disagree with the daily payments ────────────────────────
  for (const invoice of input.invoices ?? []) {
    if (!inEval(invoice.storedOn)) continue;
    // Only recent periods: an old invoice that is stored late (history back-filled) is not news.
    if (invoice.periodEnd < addDays(input.evalFrom, -35)) continue;
    // Compare with the daily payments only for a period we hold them for. Before the first day we read, there is no daily
    // data, so a total of £0 there is missing data, not a disagreement with the invoice.
    if (input.dailyCoverage) {
      const cover = input.dailyCoverage[invoice.franchiseId];
      const covered = cover != null && cover.first <= addDays(invoice.periodStart, 6) && cover.last >= addDays(invoice.periodEnd, -6);
      if (!covered) continue;
    }
    if (!invoice.reconciled) {
      out.push({
        dedupeKey: `invoice_unreadable|${invoice.id}`,
        type: "invoice_unreadable",
        severity: "attention",
        franchiseId: invoice.franchiseId,
        driverId: null,
        subjectDate: invoice.storedOn,
        title: `Invoice ${invoice.invoiceNo} could not be checked`,
        whatHappened: `The self-billed invoice ${invoice.invoiceNo} for ${label(invoice.franchiseId)} was downloaded, but its lines could not be read reliably, so it is not counted in income.`,
        actualValue: null,
        expectedValue: null,
        whyFlagged: "The lines on the invoice did not add up to its own total, so the reading cannot be trusted.",
        suggestedAction: "Open the invoice in the DPD portal and tell your developer the correct lines, or ignore it if the extras are small.",
        metric: { invoiceNo: invoice.invoiceNo },
      });
      continue;
    }
    let daily = 0;
    for (const e of input.earnings) {
      if (e.franchiseId === invoice.franchiseId && e.date >= invoice.periodStart && e.date <= invoice.periodEnd) daily += originalEarnings(e);
    }
    // Nothing at all in the daily payments for the period means the days were not read, not that nobody earned anything.
    if (daily === 0) continue;
    const diff = daily - invoice.stopPayNet;
    if (Math.abs(diff) > config.invoiceTolerancePence) {
      out.push({
        dedupeKey: `invoice_mismatch|${invoice.id}`,
        type: "invoice_mismatch",
        severity: "attention",
        franchiseId: invoice.franchiseId,
        driverId: null,
        subjectDate: invoice.storedOn,
        title: `Invoice ${invoice.invoiceNo} does not match the daily payments`,
        whatHappened: `The invoice for ${label(invoice.franchiseId)} (${formatUkDate(invoice.periodStart)} to ${formatUkDate(invoice.periodEnd)}) shows ${formatGBP(invoice.stopPayNet)} of stop pay. The daily payments for the same dates add up to ${formatGBP(daily)}.`,
        actualValue: formatGBP(daily),
        expectedValue: formatGBP(invoice.stopPayNet),
        whyFlagged: `They differ by ${formatGBP(Math.abs(diff))}, more than the ${formatGBP(config.invoiceTolerancePence)} allowed. A day may be missing from the daily payments, or posted late.`,
        suggestedAction: "Re-run the DPD sync for that period. If it still differs, compare the invoice with the Payments page.",
        metric: { daily, invoice: invoice.stopPayNet, diff },
      });
    }
  }

  // ── Costs left unassigned ─────────────────────────────────────────────────
  {
    const stale = input.costs.filter((c) => c.unassigned && c.date <= addDays(input.evalTo, -7));
    for (const [franchiseId, items] of groupBy(stale, (c) => c.franchiseId ?? "none")) {
      const total = items.reduce((a, c) => a + c.amount, 0);
      out.push({
        dedupeKey: `cost_unassigned|${franchiseId}|${weekStart(input.evalTo)}`,
        type: "cost_unassigned",
        severity: "attention",
        franchiseId: franchiseId === "none" ? null : franchiseId,
        driverId: null,
        subjectDate: input.evalTo,
        title: `${items.length} cost${items.length === 1 ? "" : "s"} still not assigned (${formatGBP(total)})`,
        whatHappened: `${items.length} cost${items.length === 1 ? " has" : "s have"} been waiting more than a week to be assigned to a driver or the franchise, ${formatGBP(total)} in all.`,
        actualValue: `${items.length} unassigned`,
        expectedValue: "None",
        whyFlagged: "Unassigned costs are counted in totals but cannot be attributed, so driver and franchise profit are less accurate until they are assigned.",
        suggestedAction: "Open Expenses, choose Unallocated, and assign each cost.",
        metric: { count: items.length, total },
      });
    }
  }

  // ── Fuel ──────────────────────────────────────────────────────────────────
  const fuelCosts = input.costs.filter((c) => c.isFuel);
  const fuelGroups = groupBy(
    fuelCosts.flatMap((c) => {
      const keys = [`franchise|${c.franchiseId ?? "none"}`];
      if (c.driverId) keys.push(`driver|${c.driverId}`);
      return keys.map((scope) => ({ scope, cost: c }));
    }),
    (x) => x.scope,
  );
  for (const [scope, items] of fuelGroups) {
    const [scopeKind, scopeId] = scope.split("|") as [string, string];
    if (scopeKind === "franchise" && scopeId === "none") continue;
    const weekly = new Map<ISODate, Pence>();
    for (const { cost } of items) weekly.set(weekStart(cost.date), (weekly.get(weekStart(cost.date)) ?? 0) + cost.amount);
    for (const [week, total] of weekly) {
      const weekEnd = addDays(week, 6);
      // Only assess complete weeks that end inside the evaluation window.
      if (weekEnd > input.evalTo || weekEnd < input.evalFrom) continue;
      const previous: Pence[] = [];
      for (let w = 1; w <= config.fuelBaselineWeeks; w++) {
        const value = weekly.get(addDays(week, -7 * w));
        if (value != null && value > 0) previous.push(value);
      }
      if (previous.length < 3) continue;
      const mean = previous.reduce((a, b) => a + b, 0) / previous.length;
      const change = pct(total, mean);
      if (change >= config.fuelWeeklyChangePct && total - mean >= config.fuelMinDiffPence) {
        const who = scopeKind === "driver" ? (driverName.get(scopeId) ?? "a driver") : label(scopeId);
        out.push({
          dedupeKey: `fuel_high|${scope}|${week}`,
          type: "fuel_high",
          severity: "attention",
          franchiseId: scopeKind === "franchise" ? scopeId : (items[0]!.cost.franchiseId ?? null),
          driverId: scopeKind === "driver" ? scopeId : null,
          subjectDate: weekEnd,
          title: `Fuel spend unusually high for ${who} (week of ${formatUkDate(week)})`,
          whatHappened: `Fuel for ${who} came to ${formatGBP(total)} in the week beginning ${formatUkDateLong(week)}.`,
          actualValue: formatGBP(total),
          expectedValue: `${formatGBP(Math.round(mean))} a week on average`,
          whyFlagged: `This is ${change}% above the average of the previous ${previous.length} weeks with fuel spend.`,
          suggestedAction: "Look through the week's fuel transactions for anything unexpected, such as extra fill-ups or a different vehicle.",
          metric: { actual: total, mean: Math.round(mean), changePct: change, weeks: previous.length },
        });
      }
    }
  }

  // Missing fuel data: a franchise that normally has fuel had none in a complete week it operated.
  for (const franchise of input.franchises) {
    const weeklyFuel = new Map<ISODate, number>();
    for (const c of fuelCosts) {
      if (c.franchiseId === franchise.id) weeklyFuel.set(weekStart(c.date), (weeklyFuel.get(weekStart(c.date)) ?? 0) + 1);
    }
    const franchiseDates = reportDatesByFranchise.get(franchise.id);
    if (!franchiseDates) continue;
    const weeksWorked = new Set([...franchiseDates].map(weekStart));
    for (const week of weeksWorked) {
      const weekEnd = addDays(week, 6);
      if (weekEnd > input.evalTo || weekEnd < input.evalFrom || weekEnd >= input.reportsExpectedThrough) continue;
      if (weeklyFuel.has(week)) continue;
      let previousWithFuel = 0;
      for (let w = 1; w <= 4; w++) if (weeklyFuel.has(addDays(week, -7 * w))) previousWithFuel++;
      if (previousWithFuel < 3) continue;
      out.push({
        dedupeKey: `missing_fuel|${franchise.id}|${week}`,
        type: "missing_fuel",
        severity: "attention",
        franchiseId: franchise.id,
        driverId: null,
        subjectDate: weekEnd,
        title: `No fuel data for ${franchise.fdNumber} (week of ${formatUkDate(week)})`,
        whatHappened: `${label(franchise.id)} operated in the week beginning ${formatUkDateLong(week)} but no fuel transactions have been imported for it.`,
        actualValue: "No fuel transactions",
        expectedValue: `Fuel transactions (present in ${previousWithFuel} of the previous 4 weeks)`,
        whyFlagged: "This franchise normally has fuel transactions every week and this week has none.",
        suggestedAction: "Check that the fuel report for this week has been downloaded or uploaded.",
        metric: { previousWithFuel },
      });
    }
  }

  // ── Possible duplicate costs ──────────────────────────────────────────────
  const duplicateGroups = groupBy(
    input.costs.filter((c) => c.amount !== 0 && !c.fromDpd),
    (c) => `${c.isFuel ? "fuel" : `cat:${c.categoryId ?? c.categoryName}`}|${c.date}|${c.amount}|${(c.vehicleRegistration ?? c.supplier ?? "").toLowerCase().replace(/\s+/g, "")}`,
  );
  for (const [, group] of duplicateGroups) {
    if (group.length < 2 || !group.some((c) => inEval(c.date))) continue;
    const firstCost = group[0]!;
    const ids = group.map((c) => c.id).sort();
    out.push({
      dedupeKey: `duplicate_cost|${ids.join("+")}`,
      type: "duplicate_cost",
      severity: "attention",
      franchiseId: firstCost.franchiseId,
      driverId: null,
      subjectDate: firstCost.date,
      title: `Possible duplicate: ${group.length} × ${formatGBP(firstCost.amount)} ${firstCost.isFuel ? "fuel" : firstCost.categoryName.toLowerCase()} on ${formatUkDate(firstCost.date)}`,
      whatHappened: `There are ${group.length} ${firstCost.isFuel ? "fuel" : firstCost.categoryName.toLowerCase()} costs of exactly ${formatGBP(firstCost.amount)} on ${formatUkDateLong(firstCost.date)}${firstCost.vehicleRegistration ? ` for vehicle ${firstCost.vehicleRegistration}` : firstCost.supplier ? ` from ${firstCost.supplier}` : ""}.`,
      actualValue: `${group.length} matching costs`,
      expectedValue: "1",
      whyFlagged: "Same date, same amount and same vehicle or supplier. They have different references, so both were kept.",
      suggestedAction: "If one is a genuine duplicate, void it in Expenses. If both are real, mark this as expected.",
      metric: { ids, amount: firstCost.amount },
    });
  }

  // ── Unusually high expenses ───────────────────────────────────────────────
  const expenseGroups = groupBy(
    input.costs.filter((c) => !c.isFuel),
    (c) => `${c.franchiseId ?? "none"}|${c.categoryId ?? c.categoryName}`,
  );
  for (const [, group] of expenseGroups) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < sorted.length; i++) {
      const expense = sorted[i]!;
      if (!inEval(expense.date) || expense.amount < config.expenseMinPence) continue;
      const earlier = sorted.slice(0, i).map((c) => c.amount);
      if (earlier.length < 4) continue;
      const typical = median(earlier);
      if (typical > 0 && expense.amount > typical * config.expenseHighMultiple) {
        out.push({
          dedupeKey: `expense_high|${expense.id}`,
          type: "expense_high",
          severity: "attention",
          franchiseId: expense.franchiseId,
          driverId: expense.driverId,
          subjectDate: expense.date,
          title: `Unusually high ${expense.categoryName.toLowerCase()} cost: ${formatGBP(expense.amount)}`,
          whatHappened: `A ${expense.categoryName.toLowerCase()} expense of ${formatGBP(expense.amount)} was recorded on ${formatUkDateLong(expense.date)}${expense.supplier ? ` (${expense.supplier})` : ""}.`,
          actualValue: formatGBP(expense.amount),
          expectedValue: `${formatGBP(Math.round(typical))} is typical for ${expense.categoryName.toLowerCase()}`,
          whyFlagged: `It is more than ${config.expenseHighMultiple} times the typical ${expense.categoryName.toLowerCase()} expense (based on ${earlier.length} earlier expenses).`,
          suggestedAction: "Check the amount against the invoice or receipt.",
          metric: { actual: expense.amount, typical: Math.round(typical), n: earlier.length },
        });
      }
    }
  }

  // ── Sources that disagree ─────────────────────────────────────────────────
  for (const conflict of input.openConflicts) {
    out.push({
      dedupeKey: `source_conflict|${conflict.id}`,
      type: "source_conflict",
      severity: "urgent",
      franchiseId: conflict.franchiseId,
      driverId: null,
      subjectDate: conflict.date,
      title: conflict.title,
      whatHappened: conflict.detail,
      actualValue: null,
      expectedValue: null,
      whyFlagged: "Two source documents give different figures for the same driver and day. The stored figures have not been changed.",
      suggestedAction: "Open Data & Integrations → Needs attention, compare the two documents and choose which figures to keep.",
      metric: { reviewItemId: conflict.id },
    });
  }

  return out;
}
