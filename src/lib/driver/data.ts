import "server-only";
import { loadAdjustments, loadEarnings, loadEarningsMeaning } from "@/lib/data/period";
import { fromDb } from "@/lib/money";
import type { DpdPeriod } from "@/lib/finance/periods";
import { buildDriverStatement, type DriverStatement } from "@/lib/finance/driver-view";
import type { DayRate } from "@/lib/finance/wages";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DriverContext } from "./context";

export interface DriverPage {
  name: string;
  statement: DriverStatement;
}

/**
 * Everything a driver's page shows, for the account and driver from their own sign-in and nothing else. The server reads
 * with its own access, so every query below names the account AND the driver; there is no route a driver can use to ask for
 * anyone else's data.
 */
export async function loadDriverPage(ctx: DriverContext, period: DpdPeriod): Promise<DriverPage> {
  const db = createAdminClient();
  const filter = { accountId: ctx.accountId, from: period.start, to: period.end, driverId: ctx.driverId };
  const [earnings, adjustments, meaning, driver, rateRows] = await Promise.all([
    loadEarnings(db, filter),
    loadAdjustments(db, filter),
    loadEarningsMeaning(db, ctx.accountId),
    db.from("drivers").select("display_name").eq("id", ctx.driverId).eq("account_id", ctx.accountId).maybeSingle(),
    db.from("driver_day_rates").select("day_rate, effective_from, pay_basis").eq("account_id", ctx.accountId).eq("driver_id", ctx.driverId).order("effective_from"),
  ]);
  const dayRates: DayRate[] = (rateRows.data ?? []).map((r) => ({ driverId: ctx.driverId, dayRate: fromDb(r.day_rate), effectiveFrom: r.effective_from, basis: r.pay_basis === "stop" ? "stop" : "day" }));
  return {
    name: driver.data?.display_name ?? "",
    statement: buildDriverStatement({ driverId: ctx.driverId, earnings, adjustments, dayRates, meaning }),
  };
}
