/**
 * What one driver sees of their own pay. Pure code: no database, no network.
 *
 * A driver sees their days (route, stops, parcels, miles), what each day pays them, and any pay adjustments. They never see the
 * franchise's income, expenses or profit, other drivers, or what DPD pays the franchise. The DPD figures are the franchise's
 * income, so a driver's pay comes only from the pay rate set for them (per day or per stop). With no rate set, the day's pay is
 * left blank, never filled in from the franchise's figures.
 */

import type { ISODate } from "@/lib/dates";
import type { EarningDetail } from "@/lib/data/period";
import { adjustmentLabel } from "@/lib/labels";
import type { Pence } from "@/lib/money";
import { sumPence } from "@/lib/money";
import { totalAdjustments, type AdjustmentRow } from "./calc";
import { rateOn, type DayRate } from "./wages";

export interface DriverAdjustmentInput extends AdjustmentRow {
  reason: string;
}

export interface DriverStatementDay {
  date: ISODate;
  route: string | null;
  stops: number | null;
  parcels: number | null;
  mileage: number | null;
  /** What the day paid the driver. Null when it cannot be worked out yet (no pay rate set, or no stop count). */
  pay: Pence | null;
}

export interface DriverStatementAdjustment {
  date: ISODate;
  label: string;
  amount: Pence;
  reason: string;
  reversal: boolean;
}

export interface DriverStatement {
  days: DriverStatementDay[];
  daysWorked: number;
  stops: number;
  /** Pay for the days that could be worked out, before adjustments. */
  dayPay: Pence;
  adjustmentsNet: Pence;
  /** dayPay plus adjustments. */
  total: Pence;
  /** Days that could not be priced yet. */
  unpricedDates: ISODate[];
  adjustments: DriverStatementAdjustment[];
}

export interface DriverStatementInput {
  driverId: string;
  earnings: EarningDetail[];
  adjustments: DriverAdjustmentInput[];
  dayRates: DayRate[];
}

export function buildDriverStatement(input: DriverStatementInput): DriverStatement {
  // Group the driver's rows by date: a driver on two routes in a day is one day.
  const byDate = new Map<ISODate, EarningDetail[]>();
  for (const e of input.earnings) {
    if (e.driverId !== input.driverId) continue; // belt and braces: only this driver's rows are ever used
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  }

  const days: DriverStatementDay[] = [];
  const unpricedDates: ISODate[] = [];
  for (const [date, rows] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const stopCounts = rows.map((r) => r.stops);
    const stops = stopCounts.some((s) => s == null) ? null : stopCounts.reduce((a: number, s) => a + (s as number), 0);
    const parcelCounts = rows.map((r) => r.parcels);
    const parcels = parcelCounts.some((p) => p == null) ? null : parcelCounts.reduce((a: number, p) => a + (p as number), 0);
    const miles = rows.map((r) => r.mileage ?? null);
    const mileage = miles.some((m) => m == null) ? null : miles.reduce((a: number, m) => a + (m as number), 0);
    const routes = [...new Set(rows.map((r) => r.route).filter((r): r is string => !!r))].sort((a, b) => a.localeCompare(b, "en-GB", { numeric: true }));

    // Only the pay rate set for this driver. The DPD figures are the franchise's income and are never shown as a driver's pay.
    const rate = rateOn(input.dayRates, input.driverId, date);
    let pay: Pence | null;
    if (!rate) pay = null;
    else if ((rate.basis ?? "day") === "stop") pay = stops == null ? null : Math.round(rate.dayRate * stops);
    else pay = rate.dayRate;
    if (pay == null) unpricedDates.push(date);
    days.push({ date, route: routes.length ? routes.join(" / ") : null, stops, parcels, mileage, pay });
  }

  const own = input.adjustments.filter((a) => a.driverId === input.driverId);
  const adjustmentsNet = totalAdjustments(own).net;
  const dayPay = sumPence(days.map((d) => d.pay ?? 0));
  return {
    days,
    daysWorked: days.length,
    stops: days.reduce((a, d) => a + (d.stops ?? 0), 0),
    dayPay,
    adjustmentsNet,
    total: dayPay + adjustmentsNet,
    unpricedDates,
    adjustments: own
      .map((a) => ({ date: a.date, label: adjustmentLabel(a.type), amount: a.amount, reason: a.reason, reversal: a.reversesId != null }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
