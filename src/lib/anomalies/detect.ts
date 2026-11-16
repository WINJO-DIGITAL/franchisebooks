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
}

export type AnomalyType =
  | "earnings_low" | "earnings_high" | "stops_low" | "stops_high" | "parcels_low" | "parcels_high"
  | "missing_driver_report" | "missing_franchise_report" | "unregistered_driver"
  | "pay_rate_changed" | "dpd_deduction_unusual" | "stops_inconsistent"
  | "fuel_high" | "missing_fuel" | "duplicate_cost" | "expense_high" | "source_conflict";

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

      // Earnings
      const earningsBase = baselineOf(history.map((h) => h.earnings), config.earningsChangePct, config.minBaselineDays);
      if (earningsBase) {
        const diff = day.earnings - earningsBase.mean;
        if ((day.earnings < earningsBase.low || day.earnings > earningsBase.high) && Math.abs(diff) >= config.earningsMinDiffPence) {
          const low = diff < 0;
          const change = pct(day.earnings, earningsBase.mean);
          out.push({
            dedupeKey: `earnings|${groupKey}|${day.date}`,
            type: low ? "earnings_low" : "earnings_high",
            severity: Math.abs(change) >= 50 ? "urgent" : "attention",
            franchiseId,
            driverId,
            subjectDate: day.date,
            title: `${name}: earnings ${low ? "well below" : "well above"} usual on ${formatUkDate(day.date)}`,
            whatHappened: `${name} earned ${formatGBP(day.earnings)} on ${formatUkDateLong(day.date)} in ${label(franchiseId)}. Their usual daily earnings are about ${formatGBP(Math.round(earningsBase.mean))}.`,
            actualValue: formatGBP(day.earnings),
            expectedValue: `${formatGBP(Math.round(earningsBase.mean))} (usual range ${formatGBP(Math.max(0, Math.round(earningsBase.low)))}–${formatGBP(Math.round(earningsBase.high))})`,
            whyFlagged: `This is ${pctText(change)} this driver's own average over ${basisText}, and outside their usual range.`,
            suggestedAction: low
              ? "Check whether it was a short day, a different route, or whether part of the day's work is missing from the DPD report."
              : "Check whether this includes cover for another route or a one-off payment, and that the DPD figure is right.",
            metric: { actual: day.earnings, mean: Math.round(earningsBase.mean), low: Math.round(earningsBase.low), high: Math.round(earningsBase.high), changePct: change, n: earningsBase.n },
          });
        }
      }

      // Stops and parcels
      const countChecks = [
        { field: "stops" as const, pctLimit: config.stopsChangePct, minDiff: config.stopsMinDiff, noun: "stops" },
        { field: "parcels" as const, pctLimit: config.parcelsChangePct, minDiff: config.parcelsMinDiff, noun: "parcels" },
      ];
      for (const check of countChecks) {
        const value = day[check.field];
        if (value == null) continue;
        const values = history.map((h) => h[check.field]).filter((v): v is number => v != null);
        const base = baselineOf(values, check.pctLimit, config.minBaselineDays);
        if (!base) continue;
        const diff = value - base.mean;
        if ((value < base.low || value > base.high) && Math.abs(diff) >= check.minDiff) {
          const low = diff < 0;
          const change = pct(value, base.mean);
          out.push({
            dedupeKey: `${check.field}|${groupKey}|${day.date}`,
            type: `${check.field}_${low ? "low" : "high"}` as AnomalyType,
            severity: "attention",
            franchiseId,
            driverId,
            subjectDate: day.date,
            title: `${name}: ${check.noun} ${low ? "well below" : "well above"} usual on ${formatUkDate(day.date)}`,
            whatHappened: `${name} completed ${value} ${check.noun} on ${formatUkDateLong(day.date)} in ${label(franchiseId)}. They usually complete about ${Math.round(base.mean)}.`,
            actualValue: `${value} ${check.noun}`,
            expectedValue: `${Math.round(base.mean)} ${check.noun} (usual range ${Math.max(0, Math.round(base.low))}–${Math.round(base.high)})`,
            whyFlagged: `This is ${pctText(change)} this driver's own average over their previous ${values.length} working days, and outside their usual range.`,
            suggestedAction: low
              ? "Check whether the route or working hours changed that day, or whether some work is missing from the report."
              : "Check whether the driver covered extra work that day. If so, you may want to record driver cover.",
            metric: { actual: value, mean: Math.round(base.mean * 10) / 10, low: Math.round(base.low), high: Math.round(base.high), changePct: change, n: base.n },
          });
        }
      }

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

    // Inconsistent stop pattern (assessed once per week)
    const recent = days.filter((d) => d.date <= input.evalTo && d.stops != null).slice(-config.baselineDays);
    if (recent.length >= Math.max(config.minBaselineDays, 8) && recent.some((d) => inEval(d.date))) {
      const stops = recent.map((d) => d.stops as number);
      const mean = stops.reduce((a, b) => a + b, 0) / stops.length;
      const stdev = Math.sqrt(stops.reduce((a, b) => a + (b - mean) ** 2, 0) / stops.length);
      const variation = mean === 0 ? 0 : Math.round((stdev / mean) * 1000) / 10;
      if (variation >= config.stopVariationPct) {
        out.push({
          dedupeKey: `stops_inconsistent|${groupKey}|${weekStart(input.evalTo)}`,
          type: "stops_inconsistent",
          severity: "info",
          franchiseId,
          driverId,
          subjectDate: recent[recent.length - 1]!.date,
          title: `${name}: stops vary a lot from day to day`,
          whatHappened: `Over ${name}'s last ${recent.length} working days in ${label(franchiseId)}, daily stops ranged from ${Math.min(...stops)} to ${Math.max(...stops)} (average ${Math.round(mean)}).`,
          actualValue: `${variation}% day-to-day variation`,
          expectedValue: `Under ${config.stopVariationPct}%`,
          whyFlagged: `Day-to-day variation in stops is ${variation}%, above the ${config.stopVariationPct}% level you have set.`,
          suggestedAction: "This may simply reflect mixed routes or part days. Look at the driver's daily history if it is unexpected.",
          metric: { variationPct: variation, min: Math.min(...stops), max: Math.max(...stops), mean: Math.round(mean), n: recent.length },
        });
      }
    }
  }

  // ── Missing reports ───────────────────────────────────────────────────────
  const reportDatesByFranchise = new Map<string, Set<ISODate>>();
  const reportDatesByDriver = new Map<string, Set<ISODate>>();
  for (const e of input.earnings) {
    if (!reportDatesByFranchise.has(e.franchiseId)) reportDatesByFranchise.set(e.franchiseId, new Set());
    reportDatesByFranchise.get(e.franchiseId)!.add(e.date);
    if (e.driverId) {
      const k = `${e.franchiseId}|${e.driverId}`;
      if (!reportDatesByDriver.has(k)) reportDatesByDriver.set(k, new Set());
      reportDatesByDriver.get(k)!.add(e.date);
    }
  }
  const usuallyPresent = (dates: Set<ISODate> | undefined, date: ISODate): number => {
    if (!dates) return 0;
    let hits = 0;
    for (let w = 1; w <= config.missingReportLookbackWeeks; w++) if (dates.has(addDays(date, -7 * w))) hits++;
    return hits;
  };
  const lastEvalDate = input.evalTo < input.reportsExpectedThrough ? input.evalTo : input.reportsExpectedThrough;

  for (const franchise of input.franchises) {
    const franchiseDates = reportDatesByFranchise.get(franchise.id);
    for (let date = input.evalFrom; date <= lastEvalDate; date = addDays(date, 1)) {
      const hits = usuallyPresent(franchiseDates, date);
      if (!franchiseDates?.has(date)) {
        if (hits >= config.missingReportMinHits) {
          out.push({
            dedupeKey: `missing_franchise_report|${franchise.id}|${date}`,
            type: "missing_franchise_report",
            severity: "urgent",
            franchiseId: franchise.id,
            driverId: null,
            subjectDate: date,
            title: `No earnings report for ${franchise.fdNumber} on ${formatUkDate(date)}`,
            whatHappened: `No daily earnings report has been imported for ${label(franchise.id)} for ${formatUkDateLong(date)}.`,
            actualValue: "No report",
            expectedValue: `A report (received on ${hits} of the last ${config.missingReportLookbackWeeks} ${weekdayName(date)}s)`,
            whyFlagged: `This franchise normally has a report on a ${weekdayName(date)}, and none has arrived for this date.`,
            suggestedAction: "Run a DPD sync, or upload the report by hand from Data & Integrations. If the franchise did not operate that day, mark this as expected.",
            metric: { hits, lookbackWeeks: config.missingReportLookbackWeeks },
          });
        }
        continue;
      }

      // The franchise report exists: is a regular driver missing from it?
      for (const assignment of input.assignments) {
        if (assignment.franchiseId !== franchise.id) continue;
        if (assignment.startDate > date || (assignment.endDate && assignment.endDate < date)) continue;
        const driver = input.drivers.find((d) => d.id === assignment.driverId);
        if (!driver || !driver.isActive) continue;
        if ((driver.startDate && driver.startDate > date) || (driver.leavingDate && driver.leavingDate < date)) continue;
        const driverDates = reportDatesByDriver.get(`${franchise.id}|${driver.id}`);
        if (driverDates?.has(date)) continue;
        const driverHits = usuallyPresent(driverDates, date);
        if (driverHits < config.missingReportMinHits) continue;
        const covered = input.covers.find(
          (c) => c.status === "active" && c.date === date && c.franchiseId === franchise.id && c.originalDriverId === driver.id,
        );
        if (covered) continue; // absence is already explained by a cover record
        out.push({
          dedupeKey: `missing_driver_report|${franchise.id}|${driver.id}|${date}`,
          type: "missing_driver_report",
          severity: "attention",
          franchiseId: franchise.id,
          driverId: driver.id,
          subjectDate: date,
          title: `${driver.name} is missing from the report for ${formatUkDate(date)}`,
          whatHappened: `The ${franchise.fdNumber} earnings report for ${formatUkDateLong(date)} has no line for ${driver.name}.`,
          actualValue: "Not on the report",
          expectedValue: `On the report (worked ${driverHits} of the last ${config.missingReportLookbackWeeks} ${weekdayName(date)}s)`,
          whyFlagged: `${driver.name} normally works on a ${weekdayName(date)} and no cover has been recorded for this date.`,
          suggestedAction: "If the driver was off, record who covered (Record Driver Cover) or mark this as expected. Otherwise check the DPD report.",
          metric: { hits: driverHits, weekday: weekdayOf(date) },
        });
      }
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
    input.costs.filter((c) => c.amount !== 0),
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
      suggestedAction: "If one is a genuine duplicate, void it in Fuel & Expenses. If both are real, mark this as expected.",
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
