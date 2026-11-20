/**
 * The Max plan's sliding-scale discrepancy report: each day's stop pay against the scale entered, in both directions.
 *
 * Only stated figures are used (stops, miles, stop pay and the scale's own rates). A day that cannot be compared is listed
 * with the reason and is never counted as agreeing or differing. Pure code, so the rules are tested without a database.
 */

import { expectedStopRate, type ScaleBand, type VehicleSpec } from "./sliding-scale";
import { gridRate, type ScaleGrid } from "./scale-grid";

/** Pounds per stop either side of the scale that is treated as agreeing (the same tolerance as Rate Checks). */
export const TOLERANCE_PER_STOP = 0.02;

export interface ReportDay {
  date: string;
  stops: number | null;
  miles: number | null;
  /** Pence paid for the day's stops (DPD's stated stop pay). */
  stopPayPence: number | null;
}

export type DayOutcome =
  | { kind: "agrees"; date: string; stops: number; expectedPerStop: number; paidPerStop: number }
  | {
      kind: "underpaid" | "overpaid";
      date: string;
      stops: number;
      expectedPerStop: number;
      paidPerStop: number;
      /** Pence difference for the day: stop pay as paid minus what the scale gives for the same stops. Negative when underpaid. */
      differencePence: number;
    }
  | { kind: "not_compared"; date: string; reason: NotComparedReason; stops?: number; paidPerStop?: number; guideRate?: number };

export type NotComparedReason = "no_stops" | "no_stop_pay" | "no_single_band" | "beyond_scale";

export const NOT_COMPARED_TEXT: Record<NotComparedReason, string> = {
  no_stops: "No stops were stated for the day.",
  no_stop_pay: "No stop pay was stated for the day.",
  no_single_band: "No single band of the scale matches the day's stops and miles (a band may be missing, or more than one may match).",
  beyond_scale: "Above the printed scale. The top rate is shown as a guide only, because DPD's rule for this is not printed, and the day is not included in the totals.",
};

/** A compared day that differs from the scale (either direction). */
export type DiffDay = Extract<DayOutcome, { differencePence: number }>;

export interface DiscrepancyReport {
  days: DayOutcome[];
  /** Underpaid days first (most underpaid first), then overpaid days (most overpaid first), then agreeing days by date. */
  ordered: DayOutcome[];
  totals: {
    comparedDays: number;
    agreedDays: number;
    underpaidDays: number;
    overpaidDays: number;
    notComparedDays: number;
    /** Sum of the underpaid days, in pence (a negative number). */
    underpaidPence: number;
    /** Sum of the overpaid days, in pence (a positive number). */
    overpaidPence: number;
    /** Underpaid plus overpaid, in pence, with its sign. */
    netPence: number;
  };
}

/**
 * Compares each day with the scale. Uses the printed grid when one is given (the rate is found by rounding stops and miles
 * down), otherwise the band table.
 */
export function buildDiscrepancyReport(days: ReportDay[], bands: ScaleBand[], vehicle: VehicleSpec, grid?: ScaleGrid): DiscrepancyReport {
  const outcomes: DayOutcome[] = days
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((d) => compareDay(d, bands, vehicle, grid));

  const underpaid = outcomes.filter((o): o is DiffDay => o.kind === "underpaid");
  const overpaid = outcomes.filter((o): o is DiffDay => o.kind === "overpaid");
  const agreed = outcomes.filter((o) => o.kind === "agrees");
  const notCompared = outcomes.filter((o) => o.kind === "not_compared");

  const underpaidPence = underpaid.reduce((n, o) => n + o.differencePence, 0);
  const overpaidPence = overpaid.reduce((n, o) => n + o.differencePence, 0);

  const ordered = [
    ...underpaid.sort((a, b) => a.differencePence - b.differencePence || (a.date < b.date ? -1 : 1)),
    ...overpaid.sort((a, b) => b.differencePence - a.differencePence || (a.date < b.date ? -1 : 1)),
    ...agreed,
    ...notCompared,
  ];

  return {
    days: outcomes,
    ordered,
    totals: {
      comparedDays: underpaid.length + overpaid.length + agreed.length,
      agreedDays: agreed.length,
      underpaidDays: underpaid.length,
      overpaidDays: overpaid.length,
      notComparedDays: notCompared.length,
      underpaidPence,
      overpaidPence,
      netPence: underpaidPence + overpaidPence,
    },
  };
}

function compareDay(d: ReportDay, bands: ScaleBand[], vehicle: VehicleSpec, grid?: ScaleGrid): DayOutcome {
  if (d.stops == null || d.stops <= 0) return { kind: "not_compared", date: d.date, reason: "no_stops" };
  if (d.stopPayPence == null) return { kind: "not_compared", date: d.date, reason: "no_stop_pay" };

  let expected: number | null;
  if (grid) {
    const found = gridRate(grid, d.stops, d.miles);
    if (found?.beyondScale) {
      return { kind: "not_compared", date: d.date, reason: "beyond_scale", stops: d.stops, paidPerStop: d.stopPayPence / 100 / d.stops, guideRate: found.rate };
    }
    expected = found?.rate ?? null;
  } else {
    expected = expectedStopRate(bands, vehicle, d.stops, d.miles);
  }
  if (expected == null) return { kind: "not_compared", date: d.date, reason: "no_single_band" };

  const paid = d.stopPayPence / 100 / d.stops;
  if (Math.abs(paid - expected) <= TOLERANCE_PER_STOP) {
    return { kind: "agrees", date: d.date, stops: d.stops, expectedPerStop: expected, paidPerStop: paid };
  }
  const differencePence = d.stopPayPence - Math.round(expected * 100 * d.stops);
  return {
    kind: differencePence < 0 ? "underpaid" : "overpaid",
    date: d.date,
    stops: d.stops,
    expectedPerStop: expected,
    paidPerStop: paid,
    differencePence,
  };
}

export interface PaymentRow {
  franchiseId: string;
  date: string;
  stops: number | null;
  mileage: number | null;
  stopPayPence: number | null;
}

/**
 * One day per franchise: several drivers can work the same franchise on one day, so their stops, miles and stop pay are
 * added together. A total is only given when every row states that figure; otherwise the day is left blank for that figure.
 */
export function dailyFromRows(rows: PaymentRow[]): Map<string, ReportDay[]> {
  const byFranchise = new Map<string, Map<string, PaymentRow[]>>();
  for (const r of rows) {
    const days = byFranchise.get(r.franchiseId) ?? new Map<string, PaymentRow[]>();
    days.set(r.date, [...(days.get(r.date) ?? []), r]);
    byFranchise.set(r.franchiseId, days);
  }
  const sum = (values: (number | null)[]): number | null => (values.length > 0 && values.every((v) => v != null) ? values.reduce((n, v) => n + (v as number), 0) : null);
  const out = new Map<string, ReportDay[]>();
  for (const [franchiseId, days] of byFranchise) {
    const list: ReportDay[] = [];
    for (const [date, group] of days) {
      list.push({ date, stops: sum(group.map((g) => g.stops)), miles: sum(group.map((g) => g.mileage)), stopPayPence: sum(group.map((g) => g.stopPayPence)) });
    }
    out.set(franchiseId, list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
  }
  return out;
}
