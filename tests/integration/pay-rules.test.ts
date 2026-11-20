import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPeriodData } from "@/lib/data/period";
import { summarisePeriod } from "@/lib/finance/calc";
import { planDriverStatements } from "@/lib/statements/generate";
import { adminClient } from "../helpers/app";
import { createFile, createTestAccount, earningsRow, ingestEarnings, pool, sql, type TestAccount } from "../helpers/db";

const db = adminClient();
let t: TestAccount;
// A DPD pay period. The driver works the five days before it and the first two days in it: seven days in a row.
const PERIOD = { start: "2026-10-12", end: "2026-11-08" };
const DAYS = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"];

beforeAll(async () => {
  t = await createTestAccount("Pay Rules Journey");
  await sql("update public.app_settings set earnings_meaning = 'route_income' where account_id = $1", [t.accountId]);
  const file = await createFile(t.accountId, t.franchiseId);
  await ingestEarnings(file, DAYS.map((d) => earningsRow(t, { report_date: d, route: "R12", stops: "120" })));
  // £120 a day, £1 a stop over 110, and £125 a day from the sixth day in a row.
  await sql(
    "insert into public.driver_day_rates (account_id, driver_id, day_rate, effective_from, pay_basis, bonus_after_stops, bonus_per_stop, streak_after_days, streak_day_rate) values ($1, $2, 120.00, '2026-01-01', 'day', 110, 1.00, 5, 125.00)",
    [t.accountId, t.driverIds[0]],
  );
}, 60_000);
afterAll(() => pool.end());

describe("pay rules through the real data path", () => {
  it("prices the first two days of a period at the days-in-a-row rate when the run began the week before, with the extra for stops on top", async () => {
    const plan = (await planDriverStatements(db, { accountId: t.accountId, franchiseId: t.franchiseId, period: PERIOD })).find((p) => p.driver.id === t.driverIds[0])!;
    expect(plan.build.ok).toBe(true);
    if (!plan.build.ok) return;
    const rows = plan.build.content.rows;
    expect(rows).toHaveLength(2);
    // Days 6 and 7 in a row: £125 plus £10 for the 10 stops over 110.
    expect(rows.map((r) => r.pay)).toEqual([13500, 13500]);
    expect(rows[0]!.rate).toMatchObject({ amount: 12500, extra: 1000, runRate: true });
    expect(plan.build.content.dayPay).toBe(27000);
    expect(plan.build.content.notes.join(" ")).toMatch(/£1\.00 for each stop over 110/);
    expect(plan.build.content.notes.join(" ")).toMatch(/£125\.00 a day from the day after 5 days in a row/);
  });

  it("counts the same wage in the period totals", async () => {
    const data = await loadPeriodData(db, { accountId: t.accountId, from: PERIOD.start, to: PERIOD.end });
    const summary = summarisePeriod(data);
    const alex = summary.combined.drivers.find((d) => d.driverId === t.driverIds[0])!;
    expect(alex.wage).toBe(27000);
    expect(alex.wageComplete).toBe(true);
  });

  it("does not give the days-in-a-row rate when the earlier days are not worked", async () => {
    const t2 = await createTestAccount("Pay Rules No Run");
    await sql("update public.app_settings set earnings_meaning = 'route_income' where account_id = $1", [t2.accountId]);
    const file = await createFile(t2.accountId, t2.franchiseId);
    await ingestEarnings(file, ["2026-10-12", "2026-10-13"].map((d) => earningsRow(t2, { report_date: d, route: "R12", stops: "120" })));
    await sql(
      "insert into public.driver_day_rates (account_id, driver_id, day_rate, effective_from, pay_basis, bonus_after_stops, bonus_per_stop, streak_after_days, streak_day_rate) values ($1, $2, 120.00, '2026-01-01', 'day', 110, 1.00, 5, 125.00)",
      [t2.accountId, t2.driverIds[0]],
    );
    const plan = (await planDriverStatements(db, { accountId: t2.accountId, franchiseId: t2.franchiseId, period: PERIOD })).find((p) => p.driver.id === t2.driverIds[0])!;
    expect(plan.build.ok && plan.build.content.rows.map((r) => r.pay)).toEqual([13000, 13000]);
  });
});
