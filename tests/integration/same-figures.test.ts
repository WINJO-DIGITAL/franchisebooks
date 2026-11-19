import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFile, createTestAccount, earningsRow, ingestEarnings, pool, sql, type TestAccount } from "../helpers/db";

let t: TestAccount;
beforeAll(async () => {
  t = await createTestAccount("Same Figures");
}, 60_000);
afterAll(() => pool.end());

const current = () => sql<{ route: string | null }>("select route from public.daily_earnings where account_id = $1 and report_date = '2026-11-20' and is_current", [t.accountId]);

describe("the same driver, franchise and day with the same figures", () => {
  it("is one record, even when a second report names the route and the first left it blank", async () => {
    const first = await ingestEarnings(await createFile(t.accountId, t.franchiseId), [earningsRow(t, { report_date: "2026-11-20", route: "" })]);
    expect(first.inserted).toBe(1);
    const second = await ingestEarnings(await createFile(t.accountId, t.franchiseId), [earningsRow(t, { report_date: "2026-11-20", route: "159" })]);
    expect(second).toMatchObject({ inserted: 0, unchanged: 1, conflicts: 0 });
    expect(await current()).toHaveLength(1);
  });

  it("keeps reading the same file again as a no-op", async () => {
    const again = await ingestEarnings(await createFile(t.accountId, t.franchiseId), [earningsRow(t, { report_date: "2026-11-20", route: "159" })]);
    expect(again).toMatchObject({ inserted: 0, unchanged: 1 });
    expect(await current()).toHaveLength(1);
  });

  it("keeps two routes on one day when their figures differ", async () => {
    const other = await ingestEarnings(await createFile(t.accountId, t.franchiseId), [
      earningsRow(t, { report_date: "2026-11-20", route: "160", stops: "55", parcels: "70", gross_earnings: "74.00", net_earnings: "74.00" }),
    ]);
    expect(other.inserted).toBe(1);
    expect(await current()).toHaveLength(2);
  });

  it("treats the same driver under both spellings of the key as one", async () => {
    const spelled = await ingestEarnings(await createFile(t.accountId, t.franchiseId), [
      earningsRow(t, { report_date: "2026-11-21", driver_key: "DR90001", gross_earnings: "200.00", net_earnings: "200.00" }),
      earningsRow(t, { report_date: "2026-11-21", driver_key: "ref:dr90001", gross_earnings: "200.00", net_earnings: "200.00" }),
    ]);
    expect(spelled.inserted).toBe(1);
    expect(spelled.unchanged).toBe(1);
  });
});
