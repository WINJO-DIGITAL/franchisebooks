/**
 * The Max plan's history window: DPD figures over the current and the previous UK tax year (6 April to 5 April).
 *
 * DPD's four-week periods do not line up with the tax year, so every period that overlaps the window is read, and the first
 * one, which starts before the window, is labelled as running outside it. Pure code.
 */

import { addDays, type ISODate } from "@/lib/dates";
import { DPD_PERIOD_DAYS, periodContaining, previousPeriod, type DpdPeriod } from "@/lib/finance/periods";

/** DPD periods in a year: 13 × 28 days = 364, so the same period last year is 13 periods back. */
export const PERIODS_PER_YEAR = 13;

/** The start (6 April) of the UK tax year that contains the date. */
export function taxYearStart(date: ISODate): ISODate {
  const year = Number(date.slice(0, 4));
  return date.slice(5) >= "04-06" ? `${year}-04-06` : `${year - 1}-04-06`;
}

/** "2025/26" for the tax year that starts on 6 April 2025. */
export function taxYearLabel(date: ISODate): string {
  const start = Number(taxYearStart(date).slice(0, 4));
  return `${start}/${String((start + 1) % 100).padStart(2, "0")}`;
}

export interface HistoryWindow {
  /** 6 April at the start of the previous tax year. */
  start: ISODate;
  /** Today: nothing after it has happened yet. */
  end: ISODate;
}

/** From the start of the previous tax year up to today. */
export function historyWindow(today: ISODate): HistoryWindow {
  const current = Number(taxYearStart(today).slice(0, 4));
  return { start: `${current - 1}-04-06`, end: today };
}

export interface HistoryPeriod extends DpdPeriod {
  /** The period starts before the history window (it overlaps its first day). */
  startsBeforeWindow: boolean;
  /** The period contains today, so it is not over yet. */
  current: boolean;
}

/** Every DPD period that overlaps the window and has started, newest first. */
export function historyPeriods(today: ISODate): HistoryPeriod[] {
  const window = historyWindow(today);
  const out: HistoryPeriod[] = [];
  let period: DpdPeriod = periodContaining(today);
  while (period.end >= window.start) {
    out.push({ ...period, startsBeforeWindow: period.start < window.start, current: period.start <= today && today <= period.end });
    period = previousPeriod(period);
  }
  return out;
}

/** The same four-week period a year earlier (13 periods back). */
export function sameTimeLastYear(period: DpdPeriod): DpdPeriod {
  const start = addDays(period.start, -PERIODS_PER_YEAR * DPD_PERIOD_DAYS);
  return { start, end: addDays(start, DPD_PERIOD_DAYS - 1) };
}
