import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as cronTick } from "@/app/api/cron/tick/route";
import { runSchedulerTick } from "@/lib/jobs/run";
import { generateMonthlyReport } from "@/lib/reports/generate";
import { buildMonthlyReport } from "@/lib/reports/monthly";
import { extractDocument } from "@/lib/ingest/extract";
import { adminClient } from "../helpers/app";
import { createFile, createTestAccount, earningsRow, ingestEarnings, pool, sql, asUser, type TestAccount } from "../helpers/db";

const db = adminClient();
let t: TestAccount;

beforeAll(async () => {
  t = await createTestAccount("Jobs And Reports");
  await sql(
    `insert into public.integration_connections (account_id, provider, status, config) values ($1, 'dpd', 'connected', '{"loginSavedAt":"2026-11-18T00:00:00Z"}'::jsonb)`, [t.accountId],
  );
}, 60_000);
afterAll(() => pool.end());

const myJobs = (type: string) => sql<{ status: string; report_date: string | null; franchise_id: string | null; trigger: string }>(
  "select status, report_date::text, franchise_id, trigger from public.import_jobs where account_id = $1 and job_type = $2 order by created_at", [t.accountId, type],
);

describe("scheduler tick", () => {
  it("queues the evening DPD sync once per franchise per day, after the UK sync time", async () => {
    const before = await runSchedulerTick(db, new Date("2026-12-01T19:00:00Z")); // 19:00 GMT — not yet 20:30
    expect(before.accounts).toBeGreaterThan(0);
    expect(await myJobs("dpd_sync")).toEqual([]);

    await runSchedulerTick(db, new Date("2026-12-01T21:00:00Z")); // 21:00 GMT
    const jobs = await myJobs("dpd_sync");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ report_date: "2026-12-01", franchise_id: t.franchiseId, trigger: "schedule", status: "queued" });
  });

  it("does not queue it again, even when the tick runs repeatedly or concurrently", async () => {
    await Promise.all([1, 2, 3, 4].map(() => runSchedulerTick(db, new Date("2026-12-01T21:05:00Z"))));
    expect(await myJobs("dpd_sync")).toHaveLength(1);
    // Even after the first job has finished, the same day is not scheduled twice.
    await sql("update public.import_jobs set status = 'succeeded', finished_at = now() where account_id = $1 and job_type = 'dpd_sync'", [t.accountId]);
    await runSchedulerTick(db, new Date("2026-12-01T22:00:00Z"));
    expect(await myJobs("dpd_sync")).toHaveLength(1);
    await runSchedulerTick(db, new Date("2026-12-02T21:00:00Z"));
    expect((await myJobs("dpd_sync")).map((j) => j.report_date)).toEqual(["2026-12-01", "2026-12-02"]);
  });

  it("respects the owner's chosen time and the on/off switch", async () => {
    await sql("update public.app_settings set sync_time_local = '23:00' where account_id = $1", [t.accountId]);
    await runSchedulerTick(db, new Date("2026-12-03T21:00:00Z"));
    expect((await myJobs("dpd_sync")).map((j) => j.report_date)).not.toContain("2026-12-03");
    await sql("update public.app_settings set sync_time_local = '20:30', sync_enabled = false where account_id = $1", [t.accountId]);
    await runSchedulerTick(db, new Date("2026-12-03T22:00:00Z"));
    expect((await myJobs("dpd_sync")).map((j) => j.report_date)).not.toContain("2026-12-03");
    await sql("update public.app_settings set sync_enabled = true where account_id = $1", [t.accountId]);
  });

  it("does not queue DPD syncs until the portal has been set up", async () => {
    const other = await createTestAccount("No Portal");
    await runSchedulerTick(db, new Date("2026-12-04T22:00:00Z"));
    const rows = await sql("select id from public.import_jobs where account_id = $1 and job_type = 'dpd_sync'", [other.accountId]);
    expect(rows).toEqual([]);
  });

  it("returns jobs left running by a crashed worker to the queue", async () => {
    await sql(
      `insert into public.import_jobs (account_id, job_type, franchise_id, report_date, status, locked_at, attempts) values ($1, 'dpd_sync', $2, '2026-12-09', 'running', now() - interval '3 hours', 1)`, [t.accountId, t.franchiseId],
    );
    const result = await runSchedulerTick(db, new Date("2026-12-09T12:00:00Z"));
    expect(result.released).toBeGreaterThanOrEqual(1);
    const [job] = await sql<{ status: string }>("select status from public.import_jobs where account_id = $1 and report_date = '2026-12-09'", [t.accountId]);
    expect(job!.status).toBe("queued");
  });

  it("queues last month's report once there was activity, and only once", async () => {
    // New accounts follow DPD four-week periods by default; this test is about the calendar-month setting.
    await sql("update public.app_settings set report_frequency = 'monthly' where account_id = $1", [t.accountId]);
    const file = await createFile(t.accountId, t.franchiseId);
    await ingestEarnings(file, [earningsRow(t, { report_date: "2026-11-10" })]);
    await runSchedulerTick(db, new Date("2026-12-02T12:00:00Z"));
    await runSchedulerTick(db, new Date("2026-12-02T13:00:00Z"));
    const jobs = await myJobs("monthly_report");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ report_date: "2026-11-01", trigger: "schedule" });
  });
});

describe("cron endpoint", () => {
  const call = (auth?: string) => cronTick(new NextRequest("http://localhost/api/cron/tick", { headers: auth ? { authorization: auth } : {} }));
  it("refuses callers without the cron secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect((await call(`Bearer ${process.env.CRON_SECRET}x`)).status).toBe(401);
  });
  it("runs the tick for Vercel Cron and processes the lighter jobs itself", async () => {
    // Each run processes at most 10 jobs, and the shared local database also holds other accounts'
    // queued jobs (for example from the browser tests). Park those so this test only waits on its own.
    await sql("update public.import_jobs set status = 'cancelled' where status = 'queued' and account_id <> $1", [t.accountId]);
    let body: { ok: boolean; workerPoked: boolean } | null = null;
    for (let i = 0; i < 20; i++) {
      const response = await call(`Bearer ${process.env.CRON_SECRET}`);
      expect(response.status).toBe(200);
      body = await response.json();
      if ((await myJobs("monthly_report"))[0]!.status === "succeeded") break;
    }
    expect(body!.ok).toBe(true);
    expect(body!.workerPoked).toBe(false); // no worker configured in tests
    const jobs = await myJobs("monthly_report");
    expect(jobs[0]!.status).toBe("succeeded");
    const reports = await sql("select trigger, report_month::text from public.monthly_reports where account_id = $1", [t.accountId]);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]).toMatchObject({ trigger: "auto", report_month: "2026-11-01" });
  }, 240_000);
});

describe("monthly report generation", () => {
  let r: TestAccount;
  beforeAll(async () => {
    r = await createTestAccount("Report Account");
    const file = await createFile(r.accountId, r.franchiseId);
    await ingestEarnings(file, [
      earningsRow(r, { report_date: "2026-10-05", gross_earnings: "200.00", net_earnings: "200.00" }),
      earningsRow(r, { report_date: "2026-10-06", gross_earnings: "100.00", net_earnings: "100.00" }),
      earningsRow(r, { report_date: "2026-10-05", driver_id: r.driverIds[1], driver_key: "name:blake sample", source_driver_name: "Blake Sample", gross_earnings: "150.00", net_earnings: "150.00" }),
    ]);
    await asUser(r.ownerId, (run) => run("select public.create_pay_adjustment($1, $2, '2026-10-05', 'additional_payment', 40, 'Extra route')", [r.franchiseId, r.driverIds[0]]));
    await asUser(r.ownerId, (run) => run("select public.create_pay_adjustment($1, $2, '2026-10-06', 'deduction', -15, 'Agreed deduction')", [r.franchiseId, r.driverIds[0]]));
    const [tx] = await sql<{ id: string }>(
      `insert into public.fuel_transactions (account_id, franchise_id, transaction_date, total_cost, source, dedupe_key) values ($1, $2, '2026-10-07', 80.00, 'manual_entry', 'rep-fuel-1') returning id`, [r.accountId, r.franchiseId],
    );
    await sql("insert into public.expense_allocations (account_id, fuel_transaction_id, scope, driver_id, method) values ($1, $2, 'driver', $3, 'manual')", [r.accountId, tx!.id, r.driverIds[0]]);
    await sql("insert into public.revenue_entries (account_id, franchise_id, period_start, period_end, amount, status) values ($1, $2, '2026-10-01', '2026-10-31', 1000.00, 'confirmed')", [r.accountId, r.franchiseId]);
  }, 60_000);

  it("report totals reconcile to the underlying records", async () => {
    const report = await buildMonthlyReport(db, { accountId: r.accountId, month: "2026-10", franchiseId: r.franchiseId });
    const t = report.totals;
    expect(t.driverOriginalEarnings).toBe(45000);
    expect(t.driverAdjustmentsNet).toBe(2500);
    expect(t.driverCosts).toBe(47500);
    expect(t.fuel).toBe(8000);
    expect(t.operatingCosts).toBe(55500);
    expect(t.operatingProfit).toBe(100000 - 55500);
    expect(t.profitStatus).toBe("confirmed");
    const alex = report.drivers.find((d) => d.name === "Alex Example")!;
    expect(alex).toMatchObject({ originalEarnings: 30000, adjustmentsNet: 2500, finalEarnings: 32500, fuel: 8000, daysWorked: 2 });
    expect(report.drivers.reduce((n, d) => n + d.finalEarnings, 0)).toBe(t.driverCosts);
    expect(report.adjustments.map((a) => a.reason)).toEqual(["Extra route", "Agreed deduction"]);
  });

  it("generates and stores a PDF that the owner can download, and records its headline totals", async () => {
    const generated = await generateMonthlyReport(db, { accountId: r.accountId, month: "2026-10", franchiseId: r.franchiseId, trigger: "manual", userId: r.ownerId });
    const file = await db.storage.from("reports").download(generated.storagePath);
    expect(file.error).toBeNull();
    const bytes = new Uint8Array(await file.data!.arrayBuffer());
    const text = (await extractDocument("r.pdf", bytes)).text.replace(/\s+/g, " ");
    expect(text).toContain("Monthly report: October 2026");
    expect(text).toContain("£450.00");
    expect(text).toContain("£475.00");
    const [row] = await sql<{ totals: Record<string, unknown>; generated_by: string; trigger: string }>("select totals, generated_by, trigger from public.monthly_reports where id = $1", [generated.id]);
    expect(row).toMatchObject({ generated_by: r.ownerId, trigger: "manual" });
    expect(row!.totals).toMatchObject({ driverCosts: "475.00", operatingProfit: "445.00", revenueStatus: "confirmed" });
    // Regenerating keeps the earlier copy.
    await generateMonthlyReport(db, { accountId: r.accountId, month: "2026-10", franchiseId: r.franchiseId, trigger: "manual", userId: r.ownerId });
    expect(await sql("select id from public.monthly_reports where account_id = $1", [r.accountId])).toHaveLength(2);
  });

  it("builds a consolidated report for all franchises", async () => {
    const report = await buildMonthlyReport(db, { accountId: r.accountId, month: "2026-10", franchiseId: null });
    expect(report.scopeLabel).toContain("consolidated");
    expect(report.totals.driverCosts).toBe(47500);
    expect(report.totals.operatingProfit).toBe(44500);
  });
});
