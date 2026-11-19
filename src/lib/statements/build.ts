/**
 * What goes on a driver statement. Pure code: the figures come only from the driver's own days, their pay rate and the pay
 * adjustments recorded for them. Nothing is estimated: if any day cannot be priced (no pay rate, or a per-stop rate with no
 * stop count), no statement is made and the reason is given instead.
 */

import { formatUkDate, type ISODate } from "@/lib/dates";
import type { EarningDetail } from "@/lib/data/period";
import { buildDriverStatement, type DriverAdjustmentInput, type DriverStatement } from "@/lib/finance/driver-view";
import type { DpdPeriod } from "@/lib/finance/periods";
import { rateOn, type DayRate } from "@/lib/finance/wages";
import type { Pence } from "@/lib/money";

/** The UK standard rate of VAT, used only for drivers who have given a VAT number. */
export const UK_STANDARD_VAT_RATE = 0.2;

export interface StatementDriver {
  id: string;
  name: string;
  vatNumber: string | null;
  selfBillingAgreement: boolean;
}

export interface StatementRow {
  date: ISODate;
  route: string | null;
  stops: number | null;
  parcels: number | null;
  /** What the rate was on the day: an amount per day or per stop. */
  rate: { amount: Pence; basis: "day" | "stop" };
  pay: Pence;
}

export interface StatementContent {
  title: "Driver statement" | "Self-billed invoice";
  number: string;
  period: DpdPeriod;
  businessName: string;
  franchise: { name: string; fdNumber: string };
  driver: StatementDriver;
  rows: StatementRow[];
  adjustments: DriverStatement["adjustments"];
  dayPay: Pence;
  adjustmentsNet: Pence;
  /** Total before VAT. */
  total: Pence;
  /** Null unless the driver has given a VAT number. */
  vat: { rate: number; amount: Pence; number: string } | null;
  totalPayable: Pence;
  issuedOn: ISODate;
}

export type StatementBuild = { ok: true; content: StatementContent } | { ok: false; reason: string };

export function buildStatementContent(input: {
  number: string;
  period: DpdPeriod;
  businessName: string;
  franchise: { name: string; fdNumber: string };
  driver: StatementDriver;
  earnings: EarningDetail[];
  adjustments: DriverAdjustmentInput[];
  dayRates: DayRate[];
  issuedOn: ISODate;
}): StatementBuild {
  const statement = buildDriverStatement({ driverId: input.driver.id, earnings: input.earnings, adjustments: input.adjustments, dayRates: input.dayRates });
  if (statement.days.length === 0 && statement.adjustments.length === 0) return { ok: false, reason: "No days worked in this period." };
  if (statement.unpricedDates.length > 0) {
    const noRate = statement.unpricedDates.filter((d) => !rateOn(input.dayRates, input.driver.id, d));
    const dates = statement.unpricedDates.slice(0, 3).map(formatUkDate).join(", ") + (statement.unpricedDates.length > 3 ? " and more" : "");
    return {
      ok: false,
      reason: noRate.length > 0
        ? `No pay rate set for ${noRate.length === statement.days.length ? "this driver" : `${noRate.length} of their days (${dates})`}. Set one under Drivers.`
        : `Pay is per stop, but DPD gave no stop count for ${statement.unpricedDates.length} day${statement.unpricedDates.length === 1 ? "" : "s"} (${dates}).`,
    };
  }
  const rows: StatementRow[] = statement.days.map((d) => {
    const rate = rateOn(input.dayRates, input.driver.id, d.date)!;
    return { date: d.date, route: d.route, stops: d.stops, parcels: d.parcels, rate: { amount: rate.dayRate, basis: rate.basis === "stop" ? "stop" : "day" }, pay: d.pay ?? 0 };
  });
  const vatNumber = input.driver.vatNumber?.trim() || null;
  const vat = vatNumber ? { rate: UK_STANDARD_VAT_RATE, amount: Math.round(statement.total * UK_STANDARD_VAT_RATE), number: vatNumber } : null;
  return {
    ok: true,
    content: {
      title: input.driver.selfBillingAgreement ? "Self-billed invoice" : "Driver statement",
      number: input.number,
      period: input.period,
      businessName: input.businessName,
      franchise: input.franchise,
      driver: input.driver,
      rows,
      adjustments: statement.adjustments,
      dayPay: statement.dayPay,
      adjustmentsNet: statement.adjustmentsNet,
      total: statement.total,
      vat,
      totalPayable: statement.total + (vat?.amount ?? 0),
      issuedOn: input.issuedOn,
    },
  };
}
