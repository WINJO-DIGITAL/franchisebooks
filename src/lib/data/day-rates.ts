import type { DayRate } from "@/lib/finance/wages";
import { fromDb, fromDbNullable } from "@/lib/money";

/**
 * Reading and mapping day rates, in one place.
 *
 * The pay rules (extra pay per stop, a days-in-a-row rate) are columns added by a later migration. Until the database has them
 * the read falls back to the original columns, so a rate set before the rules existed is still read and nothing else breaks.
 */

const BASE_COLUMNS = "driver_id, day_rate, effective_from, pay_basis";
const RULE_COLUMNS = "bonus_after_stops, bonus_per_stop, streak_after_days, streak_day_rate";

export interface DayRateRow {
  driver_id: string;
  day_rate: number | string;
  effective_from: string;
  pay_basis: string | null;
  bonus_after_stops?: number | null;
  bonus_per_stop?: number | string | null;
  streak_after_days?: number | null;
  streak_day_rate?: number | string | null;
  [column: string]: unknown;
}

interface ReadResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

function missingRuleColumn(error: { message: string; code?: string }): boolean {
  return error.code === "42703" || /bonus_after_stops|bonus_per_stop|streak_after_days|streak_day_rate/.test(error.message);
}

/**
 * Reads day-rate rows through `read`, which is given the column list to select. If the database does not have the pay-rule
 * columns yet, the read is repeated without them. Any other error is thrown: a failed read is never taken for "no rates".
 */
export async function readDayRateRows(read: (columns: string) => PromiseLike<ReadResult>, extraColumns = ""): Promise<DayRateRow[]> {
  const columns = (rules: boolean) => [BASE_COLUMNS, extraColumns, rules ? RULE_COLUMNS : ""].filter(Boolean).join(", ");
  let result = await read(columns(true));
  if (result.error && missingRuleColumn(result.error)) result = await read(columns(false));
  if (result.error) throw new Error(`Database read failed: ${result.error.message}`);
  return (result.data ?? []) as DayRateRow[];
}

/** A stored day rate as the wage code uses it (pence). `driverId` is given when the query did not select it. */
export function dayRateFromRow(row: DayRateRow, driverId?: string): DayRate {
  return {
    driverId: driverId ?? row.driver_id,
    dayRate: fromDb(row.day_rate),
    effectiveFrom: row.effective_from,
    basis: row.pay_basis === "stop" ? "stop" : "day",
    bonusAfterStops: row.bonus_after_stops ?? null,
    bonusPerStop: fromDbNullable(row.bonus_per_stop ?? null),
    streakAfterDays: row.streak_after_days ?? null,
    streakDayRate: fromDbNullable(row.streak_day_rate ?? null),
  };
}
