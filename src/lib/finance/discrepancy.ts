/**
 * The Max plan's sliding-scale discrepancy report: each route's stop pay for the day against the scale entered, in both
 * directions.
 *
 * The scale applies to each route (one driver's van for the day), so every DPD payment row is checked on its own stops and
 * miles. Rows are never added together first: two drivers' stops combined would land on a different row of the scale.
 *
 * Only stated figures are used (stops, miles, stop pay and the scale's own rates). A row that cannot be compared is listed
 * with the reason and is never counted as agreeing or differing. Pure code, so the rules are tested without a database.
 */

import { expectedStopRate, type ScaleBand, type VehicleSpec } from "./sliding-scale";
import { gridRate, type ScaleGrid } from "./scale-grid";

/**
 * Pounds per stop either side of the scale treated as agreeing, for the older band table only (the same tolerance as Rate
 * Checks). The printed grid is checked to the exact penny: stops × the printed rate is what DPD pays, and neighbouring rates
 * on the grid are often only 1p apart, so any tolerance would hide a route paid from the wrong row or column.
 */
export const TOLERANCE_PER_STOP = 0.02;

export interface ReportDay {
  date: string;
  /** Who and which route, for example "Alex Example · Route 564". Shown in the report; not used in the sums. */
  label?: string;
  stops: number | null;
  miles: number | null;
  /** Pence paid for the route's stops (DPD's stated stop pay). */
  stopPayPence: number | null;
}

type Common = { date: string; label?: string };

export type DayOutcome =
  | (Common & { kind: "agrees"; stops: number; expectedPerStop: number; paidPerStop: number })
  | (Common & {
      kind: "underpaid" | "overpaid";
      stops: number;
      expectedPerStop: number;
      paidPerStop: number;
      /** Pence difference: stop pay as paid minus what the scale gives for the same stops. Negative when underpaid. */
      differencePence: number;
    })
  | (Common & { kind: "not_compared"; reason: NotComparedReason; stops?: number; paidPerStop?: number; guideRate?: number });

export type NotComparedReason = "no_stops" | "no_stop_pay" | "no_single_band" | "beyond_scale";

export const NOT_COMPARED_TEXT: Record<NotComparedReason, string> = {
  no_stops: "No stops were stated for this route.",
  no_stop_pay: "No stop pay was stated for this route.",
  no_single_band: "The scale has no rate for these stops and miles (below the printed scale, no miles stated, or no single band matches).",
  beyond_scale: "Above the printed scale. The top rate is shown as a guide only, because DPD's rule for this is not printed, and the route is not included in the totals.",
};

/** A compared row that differs from the scale (either direction). */
export type DiffDay = Extract<DayOutcome, { differencePence: number }>;

export interface DiscrepancyReport {
  days: DayOutcome[];
  /** Underpaid rows first (most underpaid first), then overpaid (most overpaid first), then agreeing, then not compared. */
  ordered: DayOutcome[];
  totals: {
    comparedDays: number;
    agreedDays: number;
    underpaidDays: number;
    overpaidDays: number;
    notComparedDays: number;
    /** Sum of the underpaid rows, in pence (a negative number). */
    underpaidPence: number;
    /** Sum of the overpaid rows, in pence (a positive number). */
    overpaidPence: number;
    /** Underpaid plus overpaid, in pence, with its sign. */
    netPence: number;
  };
}

const byDateThenLabel = (a: { date: string; label?: string }, b: { date: string; label?: string }) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : (a.label ?? "").localeCompare(b.label ?? "", "en-GB");

/**
 * Compares each row with the scale. Uses the printed grid when one is given (rate found by rounding stops and miles down,
 * checked to the penny), otherwise the band table.
 */
export function buildDiscrepancyReport(days: ReportDay[], bands: ScaleBand[], vehicle: VehicleSpec, grid?: ScaleGrid): DiscrepancyReport {
  const outcomes: DayOutcome[] = days.slice().sort(byDateThenLabel).map((d) => compareDay(d, bands, vehicle, grid));

  const underpaid = outcomes.filter((o): o is DiffDay => o.kind === "underpaid");
  const overpaid = outcomes.filter((o): o is DiffDay => o.kind === "overpaid");
  const agreed = outcomes.filter((o) => o.kind === "agrees");
  const notCompared = outcomes.filter((o) => o.kind === "not_compared");

  const underpaidPence = underpaid.reduce((n, o) => n + o.differencePence, 0);
  const overpaidPence = overpaid.reduce((n, o) => n + o.differencePence, 0);

  const ordered = [
    ...underpaid.slice().sort((a, b) => a.differencePence - b.differencePence || byDateThenLabel(a, b)),
    ...overpaid.slice().sort((a, b) => b.differencePence - a.differencePence || byDateThenLabel(a, b)),
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
  const base: Common = { date: d.date, ...(d.label ? { label: d.label } : {}) };
  if (d.stops == null || d.stops <= 0) return { ...base, kind: "not_compared", reason: "no_stops" };
  if (d.stopPayPence == null) return { ...base, kind: "not_compared", reason: "no_stop_pay" };
  const paid = d.stopPayPence / 100 / d.stops;

  if (grid) {
    const found = gridRate(grid, d.stops, d.miles);
    if (found?.beyondScale) return { ...base, kind: "not_compared", reason: "beyond_scale", stops: d.stops, paidPerStop: paid, guideRate: found.rate };
    if (!found) return { ...base, kind: "not_compared", reason: "no_single_band" };
    // Whole pence: the printed rate is to the penny, so stops × rate is exact. Any difference at all is a difference.
    const differencePence = d.stopPayPence - Math.round(found.rate * 100) * d.stops;
    if (differencePence === 0) return { ...base, kind: "agrees", stops: d.stops, expectedPerStop: found.rate, paidPerStop: paid };
    return { ...base, kind: differencePence < 0 ? "underpaid" : "overpaid", stops: d.stops, expectedPerStop: found.rate, paidPerStop: paid, differencePence };
  }

  const expected = expectedStopRate(bands, vehicle, d.stops, d.miles);
  if (expected == null) return { ...base, kind: "not_compared", reason: "no_single_band" };
  if (Math.abs(paid - expected) <= TOLERANCE_PER_STOP + 1e-9) {
    return { ...base, kind: "agrees", stops: d.stops, expectedPerStop: expected, paidPerStop: paid };
  }
  const differencePence = d.stopPayPence - Math.round(expected * 100 * d.stops);
  return { ...base, kind: differencePence < 0 ? "underpaid" : "overpaid", stops: d.stops, expectedPerStop: expected, paidPerStop: paid, differencePence };
}

export interface PaymentRow {
  franchiseId: string;
  date: string;
  driverName: string | null;
  route: string | null;
  stops: number | null;
  mileage: number | null;
  stopPayPence: number | null;
}

/**
 * One report row per DPD payment row (one route, one day), grouped by franchise. Never added together: the scale applies to
 * each route's own stops and miles.
 */
export function routeRows(rows: PaymentRow[]): Map<string, ReportDay[]> {
  const out = new Map<string, ReportDay[]>();
  for (const r of rows) {
    const label = [r.driverName, r.route ? `Route ${r.route}` : null].filter(Boolean).join(" · ") || undefined;
    const list = out.get(r.franchiseId) ?? [];
    list.push({ date: r.date, ...(label ? { label } : {}), stops: r.stops, miles: r.mileage, stopPayPence: r.stopPayPence });
    out.set(r.franchiseId, list);
  }
  for (const list of out.values()) list.sort(byDateThenLabel);
  return out;
}
