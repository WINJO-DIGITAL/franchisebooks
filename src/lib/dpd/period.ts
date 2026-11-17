/**
 * Reporting periods in the DPD portal's "Period" drop-down.
 *
 * Each option reads like "9th November 2026 - 6th December 2026". The portal
 * groups periods under a "Year" drop-down, and a period that starts in
 * December can sit under the following year, so the year to try first is the
 * date's own and then its neighbours.
 */

import { parseUkDate, type ISODate } from "@/lib/dates";

export interface Period {
  start: ISODate;
  end: ISODate;
}

/** Reads "9th November 2026 - 6th December 2026" (hyphen, en dash or "to"). Returns null for anything else. */
export function parsePeriodText(text: string): Period | null {
  const parts = text.split(/\s+(?:-|–|—|to)\s+/i);
  if (parts.length !== 2) return null;
  const start = parseUkDate(parts[0]!);
  const end = parseUkDate(parts[1]!);
  if (!start || !end || end < start) return null;
  return { start, end };
}

/** Index of the option whose period contains the date, or -1. */
export function findPeriodIndex(optionTexts: string[], date: ISODate): number {
  return optionTexts.findIndex((text) => {
    const period = parsePeriodText(text);
    return period !== null && period.start <= date && date <= period.end;
  });
}

/**
 * True when a table's dates are consistent with the selected period: it has no dated rows, or at least one dated row
 * falls inside the period. Rows dated before the period are normal (late-posted payments), so a mix is fine; a table
 * where NO row falls inside the period is the page still showing a different period.
 */
export function tableShowsPeriod(rows: string[][], period: Period): boolean {
  const header = rows.find((r) => r.length >= 3);
  const col = header ? header.findIndex((c) => c.trim().toLowerCase() === "date") : -1;
  if (!header || col < 0) return true;
  const dates = rows.slice(rows.indexOf(header) + 1).map((r) => parseUkDate(r[col])).filter((d): d is ISODate => d !== null);
  return dates.length === 0 || dates.some((d) => d >= period.start && d <= period.end);
}

/** Years to try, in order: the date's own year, then the next, then the previous. */
export function yearCandidates(date: ISODate): string[] {
  const year = Number(date.slice(0, 4));
  return [year, year + 1, year - 1].map(String);
}
