/**
 * Driver wages from day rates or per-stop rates. Pure code: no database, no network.
 *
 * Rule: wage = sum over the days a driver worked of what that day earns at the rate in force on
 * that day. A "day" rate pays the rate once per day worked. A "stop" rate pays the rate for each
 * stop that day. A rate applies from its effective date until the next rate starts.
 *
 * A day rate can carry two optional extras, both set by the owner for that driver:
 *  - extra pay per stop: once a day passes a number of stops, each stop over it pays an extra amount
 *    (a £120 day with £1 a stop over 110 pays £130 for 120 stops);
 *  - a different day rate once the driver has worked more than a number of days in a row
 *    (£120 a day, £125 from the sixth day in a row).
 * Days in a row are calendar days with work, counted back through the days worked before the period.
 *
 * A worked day with no rate in force, or one that needs a stop count the portal did not give, is NOT
 * counted as zero: the wage is then reported as incomplete and the days are listed, so nothing is guessed.
 */

import { addDays, type ISODate } from "@/lib/dates";
import { sumPence, type Pence } from "@/lib/money";

export type PayBasis = "day" | "stop";

export interface DayRate {
  driverId: string;
  /** Pence per day worked (basis "day") or per stop (basis "stop"). */
  dayRate: Pence;
  effectiveFrom: ISODate;
  /** Defaults to "day" when not given, so existing rates keep their meaning. */
  basis?: PayBasis;
  /** Day rates only: each stop over this many stops in a day pays `bonusPerStop` extra. */
  bonusAfterStops?: number | null;
  /** Day rates only: pence for each stop over `bonusAfterStops`. */
  bonusPerStop?: Pence | null;
  /** Day rates only: from the day after this many days in a row, the day pays `streakDayRate` instead. */
  streakAfterDays?: number | null;
  /** Day rates only: pence per day once the driver is past `streakAfterDays` days in a row. */
  streakDayRate?: Pence | null;
}

export interface DriverWage {
  driverId: string;
  daysWorked: number;
  /** Total of the days that have a rate in force. */
  wage: Pence;
  /** True only when every worked day has a rate in force. */
  complete: boolean;
  /** Worked days with no rate in force, or that need a stop count that was not given (the wage is incomplete if this is non-empty). */
  missingDates: ISODate[];
}

/** One priced day, with how it was worked out. */
export interface PricedDay {
  date: ISODate;
  /** What the day pays: base plus extra. */
  pay: Pence;
  /** The day rate used (the days-in-a-row rate on a run day), or the per-stop total for a per-stop rate. */
  base: Pence;
  /** Extra pay for stops over the threshold. Zero when there is none. */
  extra: Pence;
  /** Stops over the threshold that earned extra. */
  extraStops: number;
  /** True when the day was paid at the days-in-a-row rate. */
  runRate: boolean;
  /** Which day in a row this is: 1 for the first day worked after a gap. */
  dayInARow: number;
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
 * Which day in a row each worked date is: 1 for a day with no work the day before, 2 for the next day, and so on.
 * `before` is the days worked before the period, so a run that began in the last period carries on into this one.
 */
export function dayInARowByDate(dates: ISODate[], before: ISODate[] = []): Map<ISODate, number> {
  const all = new Set<ISODate>([...before, ...dates]);
  const position = new Map<ISODate, number>();
  for (const date of [...all].sort()) {
    const prev = position.get(addDays(date, -1));
    position.set(date, prev == null ? 1 : prev + 1);
  }
  const out = new Map<ISODate, number>();
  for (const date of new Set(dates)) out.set(date, position.get(date)!);
  return out;
}

/** How many days before a period must be read to know whether a run of days reaches into it (the longest run threshold in force). */
export function lookBackDays(rates: DayRate[]): number {
  return rates.reduce((n, r) => Math.max(n, r.streakAfterDays != null && r.streakDayRate != null ? r.streakAfterDays : 0), 0);
}

/**
 * Prices one worked day at a rate. Returns null when the day cannot be priced because it needs a stop count that was not given.
 * `dayInARow` is only used by a day rate that has a days-in-a-row rate.
 */
export function priceDay(date: ISODate, rate: DayRate, stops: number | null, dayInARow: number): PricedDay | null {
  if ((rate.basis ?? "day") === "stop") {
    if (stops == null) return null;
    const pay = Math.round(rate.dayRate * stops);
    return { date, pay, base: pay, extra: 0, extraStops: 0, runRate: false, dayInARow };
  }
  const runRate = rate.streakAfterDays != null && rate.streakDayRate != null && dayInARow > rate.streakAfterDays;
  const base = runRate ? (rate.streakDayRate as Pence) : rate.dayRate;
  let extra = 0;
  let extraStops = 0;
  if (rate.bonusAfterStops != null && rate.bonusPerStop != null) {
    if (stops == null) return null;
    extraStops = Math.max(0, stops - rate.bonusAfterStops);
    extra = extraStops * rate.bonusPerStop;
  }
  return { date, pay: base + extra, base, extra, extraStops, runRate, dayInARow };
}

/**
 * Wage for one driver over the days they worked.
 * `workedDates` may contain duplicates (several routes on one day); each date counts once.
 * `stopsByDate` gives the stops worked on each date (already summed across routes); it is needed
 * for per-stop rates and for day rates with extra pay per stop. A date missing from it, or mapped to null, is reported as missing.
 * `workedBefore` is the days worked before the first date, used only to count days in a row.
 */
export function wageForDriver(
  driverId: string,
  workedDates: ISODate[],
  rates: DayRate[],
  stopsByDate: Map<ISODate, number | null> = new Map(),
  workedBefore: ISODate[] = [],
): DriverWage {
  const dates = [...new Set(workedDates)].sort();
  const inARow = dayInARowByDate(dates, workedBefore);
  const amounts: Pence[] = [];
  const missingDates: ISODate[] = [];
  for (const date of dates) {
    const rate = rateOn(rates, driverId, date);
    if (!rate) {
      missingDates.push(date);
      continue;
    }
    const priced = priceDay(date, rate, stopsByDate.get(date) ?? null, inARow.get(date)!);
    if (!priced) missingDates.push(date);
    else amounts.push(priced.pay);
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
