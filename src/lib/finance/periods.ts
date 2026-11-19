/**
 * DPD's four-week reporting periods.
 *
 * Observed in the portal: every period starts on a Monday, runs for 28 days
 * (Monday to Sunday), and they follow each other without gaps. For example
 * 9 November 2026 to 6 December 2026, then 7 December 2026 to 3 January 2027.
 * The calendar is worked out from one known start date. If DPD ever changes its
 * calendar (for example a longer period in a 53-week year) this is the one place
 * to update; the tests pin the dates seen in the portal.
 */

import { addDays, daysBetween, formatUkDate, isISODate, type ISODate } from "@/lib/dates";

/** The start of a known period (the first in the exported history). */
export const DPD_PERIOD_ANCHOR: ISODate = "2024-12-09";
export const DPD_PERIOD_DAYS = 28;

export interface DpdPeriod {
  start: ISODate;
  end: ISODate;
}

/**
 * The period report, which tells drivers what they earned, is made as soon as the period closes: the evening
 * after its last day, when the nightly sync has brought in that last day's figures. One day, not the invoice's
 * five-day payment term.
 */
export const REPORT_DELAY_DAYS_AFTER_PERIOD_END = 1;

/** The period that contains a date. */
export function periodContaining(date: ISODate): DpdPeriod {
  const offset = daysBetween(DPD_PERIOD_ANCHOR, date);
  const index = Math.floor(offset / DPD_PERIOD_DAYS);
  const start = addDays(DPD_PERIOD_ANCHOR, index * DPD_PERIOD_DAYS);
  return { start, end: addDays(start, DPD_PERIOD_DAYS - 1) };
}

export function previousPeriod(period: DpdPeriod): DpdPeriod {
  const start = addDays(period.start, -DPD_PERIOD_DAYS);
  return { start, end: addDays(start, DPD_PERIOD_DAYS - 1) };
}

/**
 * The most recent period that has closed and is ready to report on: it ended at least `graceDays`
 * days ago (default one, so the evening sync after its last day has run).
 */
export function lastCompletedPeriod(today: ISODate, graceDays = REPORT_DELAY_DAYS_AFTER_PERIOD_END): DpdPeriod {
  let period = periodContaining(today);
  while (daysBetween(period.end, today) < graceDays) period = previousPeriod(period);
  return period;
}

/** The most recent periods, newest first, for choosing one from a list. */
export function recentPeriods(today: ISODate, count: number): DpdPeriod[] {
  const out: DpdPeriod[] = [];
  let period = periodContaining(today);
  for (let i = 0; i < count; i++) {
    out.push(period);
    period = previousPeriod(period);
  }
  return out;
}

/** "9 Nov to 6 Dec 2026" style label, using UK dates. */
export function periodLabel(period: DpdPeriod): string {
  return `${formatUkDate(period.start)} to ${formatUkDate(period.end)}`;
}

/** The period a page should show: the one containing the date in the address, or the current one when there is none. */
export function periodFromParam(param: string | undefined, today: ISODate): DpdPeriod {
  return periodContaining(isISODate(param) ? param : today);
}

/** The period after this one, or null when it has not started yet (so there is nothing to show). */
export function nextPeriodIfStarted(period: DpdPeriod, today: ISODate): DpdPeriod | null {
  const start = addDays(period.start, DPD_PERIOD_DAYS);
  return start <= today ? { start, end: addDays(start, DPD_PERIOD_DAYS - 1) } : null;
}
