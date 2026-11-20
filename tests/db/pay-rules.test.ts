import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestAccount, pool, sql, type TestAccount } from "../helpers/db";

let a: TestAccount;
let driverId: string;

beforeAll(async () => {
  a = await createTestAccount("Pay Rules Ltd");
  const [d] = await sql<{ id: string }>("insert into public.drivers (account_id, display_name) values ($1, 'Rules Driver') returning id", [a.accountId]);
  driverId = d!.id;
});
afterAll(() => pool.end());

/** Inserts a day-rate row with the given columns on the given date. */
function insertRate(columns: string[], values: unknown[], from: string) {
  const placeholders = values.map((_, i) => "$" + (i + 4)).join(", ");
  return sql(
    "insert into public.driver_day_rates (account_id, driver_id, effective_from, " + columns.join(", ") + ") values ($1, $2, $3, " + placeholders + ")",
    [a.accountId, driverId, from, ...values],
  );
}

describe("pay rules on a day rate", () => {
  it("stores extra pay per stop and a days-in-a-row rate together", async () => {
    await insertRate(["day_rate", "pay_basis", "bonus_after_stops", "bonus_per_stop", "streak_after_days", "streak_day_rate"], [120, "day", 110, 1, 5, 125], "2026-11-01");
    const [r] = await sql<{ bonus_after_stops: number; bonus_per_stop: string; streak_after_days: number; streak_day_rate: string }>(
      "select bonus_after_stops, bonus_per_stop, streak_after_days, streak_day_rate from public.driver_day_rates where driver_id = $1 and effective_from = '2026-11-01'",
      [driverId],
    );
    expect(r).toEqual({ bonus_after_stops: 110, bonus_per_stop: "1.00", streak_after_days: 5, streak_day_rate: "125.00" });
  });

  it("still stores a plain rate with no extras", async () => {
    await insertRate(["day_rate", "pay_basis"], [120, "day"], "2026-10-01");
    const [r] = await sql<{ bonus_after_stops: number | null }>("select bonus_after_stops from public.driver_day_rates where driver_id = $1 and effective_from = '2026-10-01'", [driverId]);
    expect(r!.bonus_after_stops).toBeNull();
  });

  it("refuses an extra with only one of its two numbers", async () => {
    await expect(insertRate(["day_rate", "pay_basis", "bonus_after_stops"], [120, "day", 110], "2026-09-01")).rejects.toThrow(/driver_day_rates_extra_pair/);
    await expect(insertRate(["day_rate", "pay_basis", "streak_day_rate"], [120, "day", 125], "2026-09-02")).rejects.toThrow(/driver_day_rates_streak_pair/);
  });

  it("refuses extras on a per-stop rate", async () => {
    await expect(insertRate(["day_rate", "pay_basis", "bonus_after_stops", "bonus_per_stop"], [0.85, "stop", 110, 1], "2026-09-03")).rejects.toThrow(/driver_day_rates_rules_day_only/);
  });

  it("refuses numbers out of range", async () => {
    await expect(insertRate(["day_rate", "pay_basis", "streak_after_days", "streak_day_rate"], [120, "day", 0, 125], "2026-09-04")).rejects.toThrow(/check/);
    await expect(insertRate(["day_rate", "pay_basis", "bonus_after_stops", "bonus_per_stop"], [120, "day", 110, 500], "2026-09-05")).rejects.toThrow(/check/);
  });
});
