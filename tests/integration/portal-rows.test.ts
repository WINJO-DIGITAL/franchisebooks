import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFile, createTestAccount, earningsRow, ingestEarnings, pool, sql, type TestAccount } from "../helpers/db";

let t: TestAccount;
beforeAll(async () => {
  t = await createTestAccount("Portal Rows");
}, 60_000);
afterAll(() => pool.end());

const current = (date: string) => sql<{ route: string | null }>("select route from public.daily_earnings where account_id = $1 and report_date = $2 and is_current order by route", [t.accountId, date]);

describe("every portal row is a fact", () => {
  it("counts the same row read twice (same franchise, driver, day and route) once", async () => {
    const first = await ingestEarnings(await createFile(t.accountId, t.franchiseId), [earningsRow(t, { report_date: "2026-11-20", route: "159" })]);
    expect(first.inserted).toBe(1);
    const again = await ingestEarnings(await createFile(t.accountId, t.franchiseId), [earningsRow(t, { report_date: "2026-11-20", route: "159" })]);
    expect(again).toMatchObject({ inserted: 0, unchanged: 1, conflicts: 0 });
    expect(await current("2026-11-20")).toHaveLength(1);
  });

  it("keeps two routes on one day as two records when their figures differ", async () => {
    const other = await ingestEarnings(await createFile(t.accountId, t.franchiseId), [
      earningsRow(t, { report_date: "2026-11-20", route: "160", stops: "55", parcels: "70", gross_earnings: "74.00", net_earnings: "74.00" }),
    ]);
    expect(other.inserted).toBe(1);
    expect(await current("2026-11-20")).toHaveLength(2);
  });

  it("keeps two routes on one day as two records even when their figures are identical: both are on the portal", async () => {
    await ingestEarnings(await createFile(t.accountId, t.franchiseId), [earningsRow(t, { report_date: "2026-11-22", route: "159" })]);
    const second = await ingestEarnings(await createFile(t.accountId, t.franchiseId), [earningsRow(t, { report_date: "2026-11-22", route: "160" })]);
    expect(second).toMatchObject({ inserted: 1, unchanged: 0 });
    expect(await current("2026-11-22")).toHaveLength(2);
  });

  it("treats the same driver under both spellings of the key as one driver", async () => {
    const spelled = await ingestEarnings(await createFile(t.accountId, t.franchiseId), [
      earningsRow(t, { report_date: "2026-11-21", driver_key: "DR90001", route: "159", gross_earnings: "200.00", net_earnings: "200.00" }),
      earningsRow(t, { report_date: "2026-11-21", driver_key: "ref:dr90001", route: "159", gross_earnings: "200.00", net_earnings: "200.00" }),
    ]);
    expect(spelled.inserted).toBe(1);
    expect(spelled.unchanged).toBe(1);
  });
});
