import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkMissedSync, ensureNightlyWorkerRun, syncNight } from "@/lib/jobs/nightly";
import { enqueueJob } from "@/lib/jobs/queue";
import { runJob } from "@/lib/jobs/run";
import { loadCosts } from "@/lib/data/period";
import { alertAdminOfError, errorAlertKey, sendAlert } from "@/lib/notify/alerts";
import { generateDriverStatements, planDriverStatements } from "@/lib/statements/generate";
import { adminClient } from "../helpers/app";
import { addMember, asUser, createFile, createTestAccount, earningsRow, ingestEarnings, pool, sql, type TestAccount } from "../helpers/db";

const db = adminClient();
let t: TestAccount;
const P11 = { start: "2026-10-12", end: "2026-11-08" };

beforeAll(async () => {
  t = await createTestAccount("Launch Fixes");
  await sql("update public.app_settings set report_frequency = 'dpd_period' where account_id = $1", [t.accountId]);
  const file = await createFile(t.accountId, t.franchiseId);
  // Alex works three days and has a day rate; Blake works one day and has no pay rate.
  await ingestEarnings(file, [
    earningsRow(t, { report_date: "2026-10-12", route: "R12" }),
    earningsRow(t, { report_date: "2026-10-13", route: "R12" }),
    earningsRow(t, { report_date: "2026-10-14", route: "R12" }),
    earningsRow(t, { report_date: "2026-10-14", driver_id: t.driverIds[1], source_driver_name: "Blake Sample", driver_key: "name:blake sample", route: "R14" }),
  ]);
  await sql("insert into public.driver_day_rates (account_id, driver_id, day_rate, effective_from) values ($1, $2, 120.00, '2026-01-01')", [t.accountId, t.driverIds[0]]);
}, 60_000);
afterAll(() => pool.end());

describe("driver statements", () => {
  it("makes one for each driver with a pay rate, numbered by FD, period and driver, and says why the others have none", async () => {
    const run = await generateDriverStatements(db, { accountId: t.accountId, franchiseId: t.franchiseId, period: P11, trigger: "auto" });
    expect(run.made).toHaveLength(1);
    expect(run.made[0]!.number).toBe(`${t.fdNumber.toUpperCase()}-2026P11-D001`);
    expect(run.skipped).toEqual([{ driverId: t.driverIds[1], name: "Blake Sample", reason: "No pay rate set for this driver. Set one under Drivers." }]);
    const [row] = await sql<{ title: string; totals: { total: string; days: number } }>("select title, totals from public.driver_statements where account_id = $1", [t.accountId]);
    expect(row!.title).toBe("Driver statement");
    expect(row!.totals).toMatchObject({ days: 3 });
    expect(Number(row!.totals.total)).toBe(360);
  });

  it("keeps the same number when made again, and the file is replaced, not duplicated", async () => {
    await generateDriverStatements(db, { accountId: t.accountId, franchiseId: t.franchiseId, period: P11, trigger: "manual" });
    const rows = await sql<{ statement_no: string; storage_path: string }>("select statement_no, storage_path from public.driver_statements where account_id = $1", [t.accountId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statement_no).toBe(`${t.fdNumber.toUpperCase()}-2026P11-D001`);
    const file = await db.storage.from("reports").download(rows[0]!.storage_path);
    expect(file.error).toBeNull();
    expect(Buffer.from(await file.data!.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("is titled Self-billed invoice and shows VAT only when set on the driver", async () => {
    await sql("update public.drivers set self_billing_agreement = true, vat_number = 'GB123456789' where id = $1", [t.driverIds[0]]);
    const [plan] = (await planDriverStatements(db, { accountId: t.accountId, franchiseId: t.franchiseId, period: P11 })).filter((p) => p.driver.id === t.driverIds[0]);
    expect(plan!.build.ok && plan!.build.content.title).toBe("Self-billed invoice");
    expect(plan!.build.ok && plan!.build.content.vat?.amount).toBe(7200);
    await sql("update public.drivers set self_billing_agreement = false, vat_number = null where id = $1", [t.driverIds[0]]);
  });

  it("can be read by the business (owner, and a manager of that franchise) but not by anyone else", async () => {
    const manager = await addMember(t.accountId, "manager", [t.franchiseId]);
    const other = await createTestAccount("Someone Else");
    const sees = (user: string) => asUser(user, (run) => run<{ id: string }>("select id from public.driver_statements"));
    expect(await sees(t.ownerId)).toHaveLength(1);
    expect(await sees(manager)).toHaveLength(1);
    expect(await sees(other.ownerId)).toHaveLength(0);
    await expect(asUser(t.ownerId, (run) => run("insert into public.driver_statements (account_id, franchise_id, driver_id, period_start, period_end, statement_no, title, storage_path, trigger) values ($1, $2, $3, '2026-10-12', '2026-11-08', 'X', 'Driver statement', 'x', 'manual')", [t.accountId, t.franchiseId, t.driverIds[1]]))).rejects.toThrow();
  });

  it("are made by the period report job when the period closes", async () => {
    await sql("delete from public.driver_statements where account_id = $1", [t.accountId]);
    const { job } = await enqueueJob(db, { accountId: t.accountId, type: "monthly_report", reportDate: P11.start, trigger: "schedule", payload: { periodStart: P11.start, periodEnd: P11.end } });
    await runJob(db, job, {});
    const [done] = await sql<{ status: string; result_message: string | null }>("select status, coalesce(result->>'message', '') as result_message from public.import_jobs where id = $1", [job.id]);
    expect(done!.status).toBe("succeeded");
    expect(done!.result_message).toMatch(/1 driver statement made/);
    expect(await sql("select id from public.driver_statements where account_id = $1", [t.accountId])).toHaveLength(1);
    const logs = await sql<{ event: string }>("select event from public.sync_logs where account_id = $1 and event = 'driver_statement_skipped'", [t.accountId]);
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe("nightly sync start and the 23:00 check", () => {
  it("starts the GitHub run once while reads are waiting, then gives it time, at most a few times a night", async () => {
    // A few days ahead, so jobs other tests have just left running do not count as a run in progress.
    const base = new Date(Date.now() + 3 * 24 * 60 * 60_000);
    await sql("delete from public.sync_dispatches where night = $1", [syncNight(base)]);
    await sql(`insert into public.import_jobs (account_id, job_type, franchise_id, report_date, status, created_at, run_after) values ($1, 'dpd_sync', $2, '2027-01-15', 'queued', now() - interval '1 hour', now() - interval '1 hour')`, [t.accountId, t.franchiseId]);
    let starts = 0;
    const start = async () => { starts += 1; return { started: true as const }; };
    const results = await Promise.all([1, 2, 3].map(() => ensureNightlyWorkerRun(db, base, start)));
    expect(starts).toBe(1);
    expect(results.filter((r) => r.started)).toHaveLength(1);
    expect((await ensureNightlyWorkerRun(db, new Date(base.getTime() + 10 * 60_000), start)).dispatch).toBe(false);
    expect(starts).toBe(1);
    await ensureNightlyWorkerRun(db, new Date(base.getTime() + 31 * 60_000), start);
    expect(starts).toBe(2);
    await sql("delete from public.import_jobs where account_id = $1 and report_date = '2027-01-15'", [t.accountId]);
  });

  it("tells the owner once a night when a franchise has no successful read by the deadline", async () => {
    const franchises = [{ id: t.franchiseId, fd_number: t.fdNumber }];
    const missing = await checkMissedSync(db, { accountId: t.accountId, reportDate: "2027-01-20", franchises }, new Date("2027-01-20T23:05:00Z"));
    expect(missing).toEqual([t.fdNumber]);
    await checkMissedSync(db, { accountId: t.accountId, reportDate: "2027-01-20", franchises }, new Date("2027-01-20T23:10:00Z"));
    const logs = await sql("select id from public.sync_logs where account_id = $1 and event = 'nightly_sync_missing'", [t.accountId]);
    expect(logs).toHaveLength(1);
    // Once the read has succeeded, nothing is missing.
    await sql(`insert into public.import_jobs (account_id, job_type, franchise_id, report_date, status) values ($1, 'dpd_sync', $2, '2027-01-21', 'succeeded')`, [t.accountId, t.franchiseId]);
    expect(await checkMissedSync(db, { accountId: t.accountId, reportDate: "2027-01-21", franchises })).toEqual([]);
  });
});

describe("alert emails are rate-limited", () => {
  it("sends the same alert once per time slot", async () => {
    const key = `test-alert:${t.accountId}`;
    const first = await sendAlert(db, { key, bucket: "2026-11-19T20", to: "owner@example.test", subject: "Test", text: "Test" });
    const second = await sendAlert(db, { key, bucket: "2026-11-19T20", to: "owner@example.test", subject: "Test", text: "Test" });
    // Email sending is not set up in tests, so the first is recorded but "not sent"; the repeat is stopped as a duplicate.
    expect(["sent", "not_sent"]).toContain(first);
    expect(second).toBe("duplicate");
    expect(await sendAlert(db, { key, bucket: "2026-11-19T20", to: null, subject: "Test", text: "Test" })).toBe("no_recipient");
    await sql("delete from public.alert_log where alert_key = $1", [key]);
  });
});

describe("error alerts to ALERT_EMAIL", () => {
  it("emails an error at most once an hour, and not at all without ALERT_EMAIL", async () => {
    const detail = { name: "Error", message: `Launch test failure ${t.accountId}` };
    delete process.env.ALERT_EMAIL;
    expect(await alertAdminOfError(detail, { where: "test" })).toBe("no_recipient");
    process.env.ALERT_EMAIL = "admin@example.test";
    try {
      expect(["sent", "not_sent"]).toContain(await alertAdminOfError(detail, { where: "test" }));
      expect(await alertAdminOfError(detail, { where: "test" })).toBe("duplicate");
    } finally {
      delete process.env.ALERT_EMAIL;
      await sql("delete from public.alert_log where alert_key = $1", [errorAlertKey(detail, { where: "test" })]);
    }
  });
});

describe("expenses: business costs and fuel VAT", () => {
  it("counts insurance as a business cost, not as waiting to be assigned, and keeps a fuel file's stated VAT", async () => {
    const [category] = await sql<{ id: string }>("select id from public.expense_categories where account_id = $1 and name = 'Insurance'", [t.accountId]);
    await sql("insert into public.expenses (account_id, franchise_id, category_id, expense_date, description, amount, source, dedupe_key) values ($1, $2, $3, '2026-10-20', 'Van insurance', 90.00, 'manual_entry', 'test-ins-1')", [t.accountId, t.franchiseId, category!.id]);
    const fuelFile = await createFile(t.accountId, t.franchiseId);
    await sql("select public.ingest_fuel($1, $2::jsonb)", [fuelFile, JSON.stringify([
      { franchise_id: t.franchiseId, transaction_date: "2026-10-21", total_cost: "50.00", vat_amount: "10.00", vat_basis: "net", dedupe_key: "test-fuel-1" },
      { franchise_id: t.franchiseId, transaction_date: "2026-10-22", total_cost: "60.00", vat_amount: "", vat_basis: "not_stated", dedupe_key: "test-fuel-2" },
    ])]);
    const costs = await loadCosts(db, { accountId: t.accountId, from: P11.start, to: P11.end });
    const insurance = costs.find((c) => c.description === "Van insurance")!;
    expect(insurance.allocation).toEqual({ scope: "franchise" });
    expect(insurance.allocationNote).toBe("Business cost");
    const fuel = costs.filter((c) => c.kind === "fuel").map((c) => [c.amount, c.vat, c.vatBasis]);
    expect(fuel).toEqual([[5000, 1000, "net"], [6000, null, "not_stated"]]);
  });
});
