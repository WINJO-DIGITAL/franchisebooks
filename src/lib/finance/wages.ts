/**
 * Driver wages from day rates or per-stop rates. Pure code: no database, no network.
 *
 * Rule: wage = sum over the days a driver worked of what that day earns at the rate in force on
 * that day. A "day" rate pays the rate once per day worked. A "stop" rate pays the rate for each
 * stop that day. A rate applies from its effective date until the next rate starts.
 * A worked day with no rate in force, or a stop rate with no stop count for that day, is NOT
 * counted as zero: the wage is then reported as incomplete and the days are listed, so nothing is guessed.
 */

import type { ISODate } from "@/lib/dates";
import { sumPence, type Pence } from "@/lib/money";

export type PayBasis = "day" | "stop";

export interface DayRate {
  driverId: string;
  /** Pence per day worked (basis "day") or per stop (basis "stop"). */
  dayRate: Pence;
  effectiveFrom: ISODate;
  /** Defaults to "day" when not given, so existing rates keep their meaning. */
  basis?: PayBasis;
}

export interface DriverWage {
  driverId: string;
  daysWorked: number;
  /** Total of the days that have a rate in force. */
  wage: Pence;
  /** True only when every worked day has a rate in force. */
  complete: boolean;
  /** Worked days with no rate in force, or (per-stop) no stop count (the wage is incomplete if this is non-empty). */
  missingDates: ISODate[];
}

/** The rate in force for a driver on a date: the latest rate whose effective date is on or before it. */
export function rateOn(rates: DayRate[], driverId: string, date: ISODate): DayRate | null {
  let best: DayRate | null = null;
  for (const rate of rates) {
    if (rate.driverId !== driverId || rate.effectiveFrom > date) continue;
    if (!best || rate.effectiveFrom > best.effectiveFrom) best = rate;
  }
  return best;
}

/**
 * Wage for one driver over the days they worked.
 * `workedDates` may contain duplicates (several routes on one day); each date counts once.
 * `stopsByDate` gives the stops worked on each date (already summed across routes); it is needed
 * only for per-stop rates. A date missing from it, or mapped to null, is reported as missing.
 */
export function wageForDriver(
  driverId: string,
  workedDates: ISODate[],
  rates: DayRate[],
  stopsByDate: Map<ISODate, number | null> = new Map(),
): DriverWage {
  const dates = [...new Set(workedDates)].sort();
  const amounts: Pence[] = [];
  const missingDates: ISODate[] = [];
  for (const date of dates) {
    const rate = rateOn(rates, driverId, date);
    if (!rate) {
      missingDates.push(date);
      continue;
    }
    if ((rate.basis ?? "day") === "stop") {
      const stops = stopsByDate.get(date);
      if (stops == null) missingDates.push(date);
      else amounts.push(Math.round(rate.dayRate * stops));
    } else {
      amounts.push(rate.dayRate);
    }
  }
  return {
    driverId,
    daysWorked: dates.length,
    wage: sumPence(amounts),
    complete: missingDates.length === 0,
    missingDates,
  };
}

/** Days worked per driver from (driverId, date) pairs such as the current daily earnings rows. */
export function workedDatesByDriver(rows: { driverId: string; date: ISODate }[]): Map<string, ISODate[]> {
  const map = new Map<string, ISODate[]>();
  for (const row of rows) {
    const list = map.get(row.driverId) ?? [];
    list.push(row.date);
    map.set(row.driverId, list);
  }
  return map;
}
