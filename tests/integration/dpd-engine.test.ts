import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PortalError } from "@/lib/dpd/errors";
import { saveDpdLogin } from "@/lib/dpd/login";
import { portalMapSchema, type PortalMap } from "@/lib/dpd/portal-map";
import { PortalSession } from "@/lib/dpd/session";
import { PortalSessionPool } from "@/lib/dpd/sync";
import { enqueueJob } from "@/lib/jobs/queue";
import { runJob } from "@/lib/jobs/run";
import { safeClick } from "@/lib/dpd/guard";
import { adminClient } from "../helpers/app";
import { createTestAccount, pool, sql, type TestAccount } from "../helpers/db";
import { startMockPortal, type MockPortal } from "../fixtures/mock-portal";

const db = adminClient();
let t: TestAccount;
let portal: MockPortal | null = null;

const MAP = (): PortalMap => portalMapSchema.parse({
  version: 1,
  delayMs: 250,
  franchise: { mode: "url", template: "/franchise/{fd}" },
  reports: [{
    id: "earnings", label: "Daily earnings", kind: "earnings",
    navigate: [{ action: "click", target: { role: "link", name: "Daily earnings" } }],
    date: { mode: "url_param", param: "date", format: "yyyy-MM-dd" },
    collect: { mode: "download", trigger: { role: "link", name: "Download PDF" } },
  }],
});

async function setup(options: Parameters<typeof startMockPortal>[0]) {
  portal = await startMockPortal(options);
  process.env.DPD_PORTAL_URL = portal.url + "/login";
  await sql(
    `insert into public.integration_connections (account_id, provider, status, config) values ($1, 'dpd', 'connected', $2::jsonb)
     on conflict (account_id, provider) do update set config = excluded.config`, [t.accountId, JSON.stringify({ portalMap: MAP() })],
  );
  // Each account signs in with its own saved login (encrypted); the portal map here is the account's own override.
  await saveDpdLogin(db, t.accountId, null, { username: "test.user", password: options.password ?? "correct-horse" });
}

async function runSync(date: string, attempts = 1) {
  const { job } = await enqueueJob(db, { accountId: t.accountId, type: "dpd_sync", franchiseId: t.franchiseId, reportDate: date, trigger: "manual" });
  await sql("update public.import_jobs set status = 'running', attempts = $2, locked_at = now() where id = $1", [job.id, attempts]);
  const { data } = await db.from("import_jobs").select("*").eq("id", job.id).single();
  const sessions = new PortalSessionPool();
  try {
    await runJob(db, data!, { portalPool: sessions });
  } finally {
    await sessions.release();
  }
  const [after] = await sql<{ status: string; error_message: string | null; result: Record<string, unknown> | null }>("select status, error_message, result from public.import_jobs where id = $1", [job.id]);
  return { id: job.id, ...after! };
}

beforeAll(async () => {
  t = await createTestAccount("DPD Engine Test");
}, 60_000);
afterEach(async () => {
  await portal?.close();
  portal = null;
});
afterAll(() => pool.end());

describe("DPD portal automation (against a synthetic mock portal)", () => {
  it("signs in, downloads the report and imports it through the shared pipeline", async () => {
    await setup({ fdNumber: t.fdNumber });
    const result = await runSync("2026-11-14");
    expect(result.status).toBe("succeeded");
    expect(result.error_message).toBeNull();
    expect(String(result.result?.message)).toContain("DPD synchronised successfully");
    const rows = await sql("select source, report_date::text from public.daily_earnings where account_id = $1", [t.accountId]);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.source === "dpd_portal" && r.report_date === "2026-11-14")).toBe(true);
    const [file] = await sql("select source, source_ref, status from public.imported_files where account_id = $1 and source = 'dpd_portal'", [t.accountId]);
    expect(file).toMatchObject({ status: "imported" });
    const [conn] = await sql("select status, last_success_at from public.integration_connections where account_id = $1 and provider = 'dpd'", [t.accountId]);
    expect(conn).toMatchObject({ status: "connected" });
    expect(conn!.last_success_at).not.toBeNull();
    expect(portal!.writeHits()).toBe(0);
  }, 90_000);

  it("is idempotent: syncing the same day again imports nothing new", async () => {
    await setup({ fdNumber: t.fdNumber });
    const again = await runSync("2026-11-14");
    expect(again.status).toBe("succeeded");
    const [{ count }] = await sql<{ count: string }>("select count(*)::text from public.daily_earnings where account_id = $1", [t.accountId]) as [{ count: string }];
    expect(count).toBe("4");
  }, 90_000);

  it("never makes a write request — the only POST is the sign-in", async () => {
    await setup({ fdNumber: t.fdNumber });
    const session = await PortalSession.open({ url: portal!.url + "/login", username: "test.user", password: "correct-horse", loginSecret: null }, MAP());
    try {
      await session.login();
      // A script on the page (or a bug) trying to submit data is blocked at the network level.
      const outcome = await session.page.evaluate(async () => {
        try {
          await fetch("/approve", { method: "POST" });
          return "sent";
        } catch {
          return "blocked";
        }
      });
      expect(outcome).toBe("blocked");
      for (const method of ["PUT", "DELETE", "PATCH"]) {
        const result = await session.page.evaluate(async (m) => fetch("/home", { method: m }).then(() => "sent").catch(() => "blocked"), method);
        expect(result).toBe("blocked");
      }
      expect(portal!.writeHits()).toBe(0);
      expect(session.guard.blocked.length).toBeGreaterThanOrEqual(4);
      // Even the login POST is no longer allowed once signed in.
      const again = await session.page.evaluate(async () => fetch("/login", { method: "POST", body: "u=a&p=b" }).then(() => "sent").catch(() => "blocked"));
      expect(again).toBe("blocked");
    } finally {
      await session.close();
    }
    expect(portal!.hits.filter((h) => h.method !== "GET").map((h) => h.path)).toEqual(["/login"]);
  }, 90_000);

  it("refuses to click anything that looks like a write action or submits a form", async () => {
    await setup({ fdNumber: t.fdNumber });
    const session = await PortalSession.open({ url: portal!.url + "/login", username: "test.user", password: "correct-horse", loginSecret: null }, MAP());
    try {
      await session.login();
      await session.goto(`/franchise/${t.fdNumber}`, "test");
      await expect(safeClick(session.page.getByRole("link", { name: "Delete statement" }), "Delete statement")).rejects.toMatchObject({ kind: "config" });
      await expect(safeClick(session.page.getByRole("button", { name: "Approve" }), "Approve")).rejects.toBeInstanceOf(PortalError);
      expect(portal!.writeHits()).toBe(0);
    } finally {
      await session.close();
    }
  }, 90_000);

  it("stops at two-step verification and tells the owner to use manual upload", async () => {
    await setup({ fdNumber: t.fdNumber, mfa: true });
    const result = await runSync("2026-11-15");
    expect(result.status).toBe("blocked");
    expect(result.error_message).toMatch(/verification code/);
    expect(result.error_message).toMatch(/upload them by hand|Dropbox/);
    const [log] = await sql<{ message: string }>("select message from public.sync_logs where import_job_id = $1 and event = 'job_blocked'", [result.id]);
    expect(log).toBeDefined();
  }, 90_000);

  it("reports wrong credentials in plain English and does not retry", async () => {
    await setup({ fdNumber: t.fdNumber, password: "right" });
    await saveDpdLogin(db, t.accountId, null, { username: "test.user", password: "wrong" });
    const result = await runSync("2026-11-16");
    expect(result.status).toBe("blocked");
    expect(result.error_message).toMatch(/did not accept this username and password/);
  }, 90_000);

  it("handles a portal layout change: records it, keeps going and queues a retry", async () => {
    await setup({ fdNumber: t.fdNumber, downloadLabel: "Get statement (new button)" });
    const result = await runSync("2026-11-17", 1);
    expect(result.status).toBe("queued"); // re-queued with backoff, not lost
    expect(result.error_message).toMatch(/layout may have changed/);
    expect(result.error_message).toMatch(/tried again automatically/);
    const [log] = await sql<{ level: string; detail: { report: string; step: string; screenshotPath: string | null } }>(
      "select level, detail from public.sync_logs where import_job_id = $1 and event = 'report_failed'", [result.id],
    );
    expect(log!.level).toBe("error");
    expect(log!.detail.report).toBe("earnings");
    expect(log!.detail.step).toBe("earnings:download");
    expect(log!.detail.screenshotPath).toMatch(/\.png$/);
    const shot = await db.storage.from("diagnostics").download(log!.detail.screenshotPath!);
    expect(shot.error).toBeNull();
    // Nothing partial was stored for that day.
    expect(await sql("select id from public.daily_earnings where account_id = $1 and report_date = '2026-11-17'", [t.accountId])).toEqual([]);
  }, 90_000);

  it("gives up after the last attempt and says so", async () => {
    await setup({ fdNumber: t.fdNumber, downloadLabel: "Get statement (new button)" });
    const result = await runSync("2026-11-18", 3);
    expect(result.status).toBe("failed");
    expect(result.error_message).not.toMatch(/tried again automatically/);
  }, 90_000);

  it("sends a report it cannot trust to the review queue instead of importing it", async () => {
    await setup({ fdNumber: t.fdNumber, corruptPdf: true });
    const result = await runSync("2026-11-19");
    expect(result.status).toBe("partial");
    expect(String(result.result?.message)).toMatch(/need checking/);
    expect(await sql("select id from public.daily_earnings where account_id = $1 and report_date = '2026-11-19'", [t.accountId])).toEqual([]);
    const reviews = await sql("select kind from public.review_items where account_id = $1 and status = 'open' and kind = 'low_confidence'", [t.accountId]);
    expect(reviews.length).toBeGreaterThan(0);
  }, 90_000);

  it("reports a day with no report on the portal as a failure rather than inventing data", async () => {
    await setup({ fdNumber: t.fdNumber, missingDates: ["2026-11-20"] });
    const result = await runSync("2026-11-20");
    expect(result.status).toBe("queued");
    expect(result.error_message).toBeTruthy();
    expect(await sql("select id from public.daily_earnings where account_id = $1 and report_date = '2026-11-20'", [t.accountId])).toEqual([]);
  }, 90_000);
});

describe("Max plan history reads (period drop-down)", () => {
  const PERIOD_MAP = (): PortalMap => portalMapSchema.parse({
    version: 1,
    delayMs: 250,
    franchise: { mode: "url", template: "/franchise/{fd}" },
    reports: [{
      id: "payments", label: "Payments", kind: "earnings",
      navigate: [{ action: "click", target: { role: "link", name: "Payments" } }],
      date: { mode: "period_select" },
      collect: { mode: "table" },
    }],
  });

  async function setupPeriods() {
    portal = await startMockPortal({ fdNumber: t.fdNumber, periods: { years: ["2026", "2020"], options: ["9th November 2026 - 6th December 2026"] } });
    process.env.DPD_PORTAL_URL = portal.url + "/login";
    await sql(
      `insert into public.integration_connections (account_id, provider, status, config) values ($1, 'dpd', 'connected', $2::jsonb)
       on conflict (account_id, provider) do update set config = excluded.config`, [t.accountId, JSON.stringify({ portalMap: PERIOD_MAP() })],
    );
    await saveDpdLogin(db, t.accountId, null, { username: "test.user", password: "correct-horse" });
  }

  async function runPeriodSync(date: string, payload: Record<string, unknown>) {
    const { job } = await enqueueJob(db, { accountId: t.accountId, type: "dpd_sync", franchiseId: t.franchiseId, reportDate: date, trigger: "schedule", payload });
    await sql("update public.import_jobs set status = 'running', attempts = 1, locked_at = now() where id = $1", [job.id]);
    const { data } = await db.from("import_jobs").select("*").eq("id", job.id).single();
    const sessions = new PortalSessionPool();
    try {
      await runJob(db, data!, { portalPool: sessions });
    } finally {
      await sessions.release();
    }
    const [after] = await sql<{ status: string; result: Record<string, unknown> | null }>("select status, result from public.import_jobs where id = $1", [job.id]);
    return after!;
  }

  /** Sets the plan on the test account's owner: history reads are a Max feature. */
  const setPlan = (plan: "max" | "standard") => sql(
    "insert into public.user_billing (user_id, plan, status) values ($1, $2, 'active') on conflict (user_id) do update set plan = excluded.plan, status = 'active'",
    [t.ownerId, plan],
  );

  it("does not run a history read for an account that is on Essential", async () => {
    await setupPeriods();
    await setPlan("standard");
    const after = await runPeriodSync("2020-03-02", { history: true });
    expect(after.status).toBe("blocked");
    expect(after.result).toMatchObject({ skippedBecause: "essential_plan" });
    expect(portal!.writeHits()).toBe(0);
  }, 180_000);

  it("records a period DPD does not list as not listed, finished and not retried", async () => {
    await setupPeriods();
    await setPlan("max");
    const after = await runPeriodSync("2020-01-06", { history: true });
    expect(after.status).toBe("succeeded");
    expect(after.result).toMatchObject({ periodListed: false, history: true });
    expect(portal!.writeHits()).toBe(0);
  }, 180_000);

  it("still treats a missing period as a problem on a normal read", async () => {
    await setupPeriods();
    const after = await runPeriodSync("2020-02-03", {});
    expect(after.status).not.toBe("succeeded");
    expect(after.result?.periodListed).toBeUndefined();
  }, 180_000);
});

