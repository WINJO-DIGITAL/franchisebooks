import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listScales } from "@/lib/finance/scale-library";
import { generateExtraReport } from "@/lib/reports/generate";
import { adminClient } from "../helpers/app";
import { createFile, createTestAccount, earningsRow, ingestEarnings, pool, sql, type TestAccount } from "../helpers/db";

const db = adminClient();
let t: TestAccount;
const PERIOD = { start: "2026-10-12", end: "2026-11-08" };

beforeAll(async () => {
  t = await createTestAccount("End Of Period Reports");
  await sql("update public.app_settings set earnings_meaning = 'route_income' where account_id = $1", [t.accountId]);
  const file = await createFile(t.accountId, t.franchiseId);
  await ingestEarnings(file, ["2026-10-12", "2026-10-13"].map((d) => earningsRow(t, { report_date: d, route: "R12", stops: "120", stop_pay: "102.00", mileage: "40" })));
  await sql("insert into public.driver_day_rates (account_id, driver_id, day_rate, effective_from, pay_basis) values ($1, $2, 120.00, '2026-01-01', 'day')", [t.accountId, t.driverIds[0]]);
}, 60_000);
afterAll(() => pool.end());

/** Set REPORT_DUMP to a folder to keep the PDFs for a look by eye. */
async function dump(name: string, storagePath: string) {
  if (!process.env.REPORT_DUMP) return;
  const { writeFile } = await import("node:fs/promises");
  const file = await db.storage.from("reports").download(storagePath);
  await writeFile(`${process.env.REPORT_DUMP}/${name}.pdf`, Buffer.from(await file.data!.arrayBuffer()));
}

const stored = async (id: string) => (await sql<{ kind: string; storage_path: string; totals: Record<string, unknown> }>("select kind, storage_path, totals from public.monthly_reports where id = $1", [id]))[0]!;

describe("end-of-period reports", () => {
  it("makes the Driver Pay Report as a PDF and records its kind and total", async () => {
    const made = await generateExtraReport(db, { accountId: t.accountId, kind: "driver_pay", franchiseId: t.franchiseId, period: PERIOD, trigger: "manual" });
    expect(made).not.toBeNull();
    const row = await stored(made!.id);
    expect(row.kind).toBe("driver_pay");
    expect(row.totals.summary).toBe("£240.00 owed to 1 driver");
    await dump("driver-pay", row.storage_path);
    const file = await db.storage.from("reports").download(row.storage_path);
    expect(Buffer.from(await file.data!.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("makes Profit and Loss, with profit not stated until every driver is priced", async () => {
    const made = await generateExtraReport(db, { accountId: t.accountId, kind: "profit_loss", franchiseId: t.franchiseId, period: PERIOD, trigger: "auto" });
    const row = await stored(made!.id);
    expect(row.kind).toBe("profit_loss");
    expect(row.totals.wagesComplete).toBe(true);
    expect(row.totals.summary).toMatch(/^Profit /);
    await dump("profit-loss", row.storage_path);
  });

  it("makes nothing for the Sliding Scale Discrepancy until a scale is chosen, then a PDF and a CSV", async () => {
    expect(await generateExtraReport(db, { accountId: t.accountId, kind: "discrepancy", franchiseId: t.franchiseId, period: PERIOD, trigger: "manual" })).toBeNull();
    const [scale] = await listScales();
    await sql("update public.franchises set sliding_scale_key = $2 where id = $1", [t.franchiseId, scale!.key]);
    const made = await generateExtraReport(db, { accountId: t.accountId, kind: "discrepancy", franchiseId: t.franchiseId, period: PERIOD, trigger: "manual" });
    expect(made).not.toBeNull();
    const row = await stored(made!.id);
    expect(row.kind).toBe("discrepancy");
    await dump("discrepancy", row.storage_path);
    const csv = await db.storage.from("reports").download(row.storage_path.replace(/\.pdf$/, ".csv"));
    const text = await csv.data!.text();
    expect(text.split("\r\n")[0]).toBe("Date,Driver and Route,Stops,Paid Per Stop,Scale Per Stop,Difference,Result,Note");
    expect(text.split("\r\n").length).toBeGreaterThanOrEqual(3);
  });
});
