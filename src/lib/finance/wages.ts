/**
 * Driver wages from day rates. Pure code: no database, no network.
 *
 * Rule: wage = sum over the days a driver worked of the day rate in force on
 * that day. A rate applies from its effective date until the next rate starts.
 * A worked day with no rate in force is NOT counted as zero: the wage is then
 * reported as incomplete and the missing days are listed, so nothing is guessed.
 */

import type { ISODate } from "@/lib/dates";
import { sumPence, type Pence } from "@/lib/money";

export interface DayRate {
  driverId: string;
  /** Pence per day worked. */
  dayRate: Pence;
  effectiveFrom: ISODate;
}

export interface DriverWage {
  driverId: string;
  daysWorked: number;
  /** Total of the days that have a rate in force. */
  wage: Pence;
  /** True only when every worked day has a rate in force. */
  complete: boolean;
  /** Worked days with no rate in force (the wage is incomplete if this is non-empty). */
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
 */
export function wageForDriver(driverId: string, workedDates: ISODate[], rates: DayRate[]): DriverWage {
  const dates = [...new Set(workedDates)].sort();
  const amounts: Pence[] = [];
  const missingDates: ISODate[] = [];
  for (const date of dates) {
    const rate = rateOn(rates, driverId, date);
    if (rate) amounts.push(rate.dayRate);
    else missingDates.push(date);
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
