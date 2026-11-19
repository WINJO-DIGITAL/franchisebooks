/**
 * Summaries for the Max plan's Insights pages. Only DPD's own figures are used: sums, per-stop and per-parcel figures, and
 * changes between periods. Nothing is estimated. A period that has not been read has no figures (it is never shown as zero);
 * a period that was read and has no payments is a true zero. Pure code.
 */

import type { ISODate } from "@/lib/dates";
import { percentChange, perUnit, sumPence, type Pence } from "@/lib/money";
import { periodReadStatus, type Coverage, type PeriodReadStatus } from "./coverage";
import { sameTimeLastYear, type HistoryPeriod } from "./window";

export interface InsightDay {
  franchiseId: string;
  driverId: string | null;
  driverKey: string;
  date: ISODate;
  stops: number | null;
  parcels: number | null;
  /** DPD's total for the day, in pence. */
  gross: Pence;
}

/** How much of a period has been read across the franchises in view. */
export type ScopeStatus = "read" | "partly_read" | "queued" | "not_listed" | "not_read";

export function scopeStatus(coverage: Coverage, franchiseIds: string[], periodStart: ISODate): ScopeStatus {
  if (franchiseIds.length === 0) return "not_read";
  const each: PeriodReadStatus[] = franchiseIds.map((id) => periodReadStatus(coverage, id, periodStart));
  const read = each.filter((s) => s === "read").length;
  if (read === each.length) return "read";
  if (read > 0) return "partly_read";
  if (each.every((s) => s === "not_listed")) return "not_listed";
  if (each.some((s) => s === "queued")) return "queued";
  return "not_read";
}

export interface PeriodFigures {
  /** Days with at least one DPD payment. */
  daysWithPayments: number;
  income: Pence;
  stops: number;
  parcels: number;
  /** Income per stop and per parcel, in pence. Null when there were none. */
  perStop: Pence | null;
  perParcel: Pence | null;
}

export interface PeriodSummary {
  period: HistoryPeriod;
  status: ScopeStatus;
  /** Null when no franchise in view has been read for the period. */
  figures: PeriodFigures | null;
}

function figuresOf(days: InsightDay[]): PeriodFigures {
  const income = sumPence(days.map((d) => d.gross));
  const stops = days.reduce((n, d) => n + (d.stops ?? 0), 0);
  const parcels = days.reduce((n, d) => n + (d.parcels ?? 0), 0);
  return { daysWithPayments: new Set(days.map((d) => d.date)).size, income, stops, parcels, perStop: perUnit(income, stops), perParcel: perUnit(income, parcels) };
}

function inPeriod(day: InsightDay, period: { start: ISODate; end: ISODate }): boolean {
  return day.date >= period.start && day.date <= period.end;
}

/** One summary per period, in the order given. */
export function summarisePeriods(days: InsightDay[], periods: HistoryPeriod[], coverage: Coverage, franchiseIds: string[]): PeriodSummary[] {
  const ids = new Set(franchiseIds);
  return periods.map((period) => {
    const status = scopeStatus(coverage, franchiseIds, period.start);
    const readable = status === "read" || status === "partly_read";
    return { period, status, figures: readable ? figuresOf(days.filter((d) => ids.has(d.franchiseId) && inPeriod(d, period))) : null };
  });
}

/** The summary for the same period a year earlier, when it is in the list. */
export function lastYear(summaries: PeriodSummary[], period: { start: ISODate; end: ISODate }): PeriodSummary | null {
  const start = sameTimeLastYear(period).start;
  return summaries.find((s) => s.period.start === start) ?? null;
}

export interface DriverPerformance {
  /** The driver's id, or "unregistered:<key>" for a name DPD gave that is not matched to a driver yet. */
  key: string;
  driverId: string | null;
  /** Stops in each period, oldest first, lined up with `periods`. Null where the period was not read. */
  stopsByPeriod: (number | null)[];
  latest: { days: number; stops: number; parcels: number; pay: Pence; stopsPerDay: number | null } | null;
  /** Change in stops per working day, latest period against the one before, in percent. */
  stopsPerDayChange: number | null;
  /** The drop is at least the account's stop-change setting. */
  dropped: boolean;
}

/**
 * Per driver: stops in each of the read periods, and how the latest period compares with the one before on stops per
 * working day. `periods` are oldest first and should be finished periods only (a period in progress would always look low).
 */
export function driverPerformance(days: InsightDay[], periods: { start: ISODate; end: ISODate; read: boolean }[], dropPct: number): DriverPerformance[] {
  const keyOf = (d: InsightDay) => d.driverId ?? `unregistered:${d.driverKey}`;
  const byDriver = new Map<string, InsightDay[]>();
  for (const d of days) byDriver.set(keyOf(d), [...(byDriver.get(keyOf(d)) ?? []), d]);

  const out: DriverPerformance[] = [];
  for (const [key, rows] of byDriver) {
    const per = periods.map((p) => (p.read ? rows.filter((d) => inPeriod(d, p)) : null));
    const stopsByPeriod = per.map((r) => (r ? r.reduce((n, d) => n + (d.stops ?? 0), 0) : null));
    const stat = (r: InsightDay[]) => {
      const workDays = new Set(r.map((d) => d.date)).size;
      const stops = r.reduce((n, d) => n + (d.stops ?? 0), 0);
      return { days: workDays, stops, parcels: r.reduce((n, d) => n + (d.parcels ?? 0), 0), pay: sumPence(r.map((d) => d.gross)), stopsPerDay: workDays > 0 ? stops / workDays : null };
    };
    const lastRows = per[per.length - 1];
    const prevRows = per[per.length - 2];
    const latest = lastRows && lastRows.length > 0 ? stat(lastRows) : null;
    const previous = prevRows && prevRows.length > 0 ? stat(prevRows) : null;
    // Stops per working day compared as whole numbers (cross-multiplied), so the percentage rounds the same way as elsewhere.
    const change = latest && previous && latest.days > 0 && previous.days > 0
      ? percentChange(previous.stops * latest.days, latest.stops * previous.days)
      : null;
    out.push({ key, driverId: rows[0]!.driverId, stopsByPeriod, latest, stopsPerDayChange: change, dropped: change != null && change <= -dropPct });
  }
  return out;
}
