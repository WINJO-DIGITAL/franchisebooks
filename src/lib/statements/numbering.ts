/**
 * Driver statement numbers, such as FD42102-2026P11-D001. Pure code.
 *
 *   FD42102  the franchise's FD number
 *   2026P11  the DPD pay period: the 11th period to start in 2026
 *   D001     the driver's own number in the business, given on their first statement and never changed
 *
 * The same driver, franchise and period always gives the same number, so a statement made again keeps its number.
 */

import { addDays, type ISODate } from "@/lib/dates";
import { DPD_PERIOD_DAYS, periodContaining, type DpdPeriod } from "@/lib/finance/periods";

/** Which period of its calendar year a DPD period is: 1 for the first period to start in that year, and so on. */
export function periodNumberInYear(period: DpdPeriod): { year: number; number: number } {
  const year = Number(period.start.slice(0, 4));
  let start = periodContaining(period.start).start;
  let number = 0;
  while (start.slice(0, 4) === String(year)) {
    number += 1;
    start = addDays(start, -DPD_PERIOD_DAYS);
  }
  return { year, number };
}

export function periodCode(period: DpdPeriod): string {
  const { year, number } = periodNumberInYear(period);
  return `${year}P${number}`;
}

export function statementNumber(fdNumber: string, period: DpdPeriod, driverNo: number): string {
  const fd = fdNumber.trim().toUpperCase().replace(/\s+/g, "");
  return `${fd}-${periodCode(period)}-D${String(driverNo).padStart(3, "0")}`;
}

/** A safe file name for a statement PDF. */
export function statementFileName(number: string, driverName: string): string {
  const name = driverName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "driver";
  return `${number}-${name}.pdf`;
}

export type { ISODate };
