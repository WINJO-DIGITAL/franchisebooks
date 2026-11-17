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

import { addDays, daysBetween, formatUkDate, type ISODate } from "@/lib/dates";

/** The start of a known period (the first in the exported history). */
export const DPD_PERIOD_ANCHOR: ISODate = "2024-12-09";
export const DPD_PERIOD_DAYS = 28;

export interface DpdPeriod {
  start: ISODate;
  end: ISODate;
}

/**
 * DPD dates each self-billed invoice on the last day of the period and makes it due five days later
 * (checked on six invoices: period ending Sunday 8 Nov 2026, invoice dated 08/11/2026, due 13/11/2026).
 * The period report is generated on that due date.
 */
export const INVOICE_DUE_DAYS_AFTER_PERIOD_END = 5;

/** The date DPD's self-billed invoice for a period falls due, and the day its report is generated. */
export function invoiceDueDate(period: DpdPeriod): ISODate {
  return addDays(period.end, INVOICE_DUE_DAYS_AFTER_PERIOD_END);
}

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
 * The most recent period whose invoice is now due: it ended at least `graceDays`
 * days ago. The default is the invoice due date (five days after the end), which
 * also leaves time for the last day's figures to have synced.
 */
export function lastCompletedPeriod(today: ISODate, graceDays = INVOICE_DUE_DAYS_AFTER_PERIOD_END): DpdPeriod {
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
