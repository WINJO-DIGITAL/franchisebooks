import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueJob } from "@/lib/jobs/queue";
import { checkPortalDrift, sixHourBucket } from "@/lib/jobs/portal-drift";
import { adminClient } from "../helpers/app";
import { createTestAccount, pool, sql, type TestAccount } from "../helpers/db";

const db = adminClient();
let a: TestAccount;
let b: TestAccount;

beforeAll(async () => {
  a = await createTestAccount("Drift A");
  b = await createTestAccount("Drift B");
}, 60_000);
afterAll(() => pool.end());

/** Logs one failed DPD read the way the job runner does: a retry with the failure type and step in its detail. */
async function logLayoutFailure(t: TestAccount, date: string, step: string) {
  const { job } = await enqueueJob(db, { accountId: t.accountId, type: "dpd_sync", franchiseId: t.franchiseId, reportDate: date, trigger: "schedule" });
  await sql(
    `insert into public.sync_logs (account_id, integration, import_job_id, franchise_id, level, event, message, detail)
     values ($1, 'dpd', $2, $3, 'warning', 'job_retry', 'The table was not found.', $4::jsonb)`,
    [t.accountId, job.id, t.franchiseId, JSON.stringify({ kind: "layout", step, error: { message: "x" } })],
  );
}

describe("portal change check", () => {
  it("counts the reads that failed on layout", async () => {
    const before = (await checkPortalDrift(db))?.jobs ?? 0;
    await logLayoutFailure(a, "2026-11-01", "payments:table");
    await logLayoutFailure(b, "2026-11-01", "payments:table");
    const after = await checkPortalDrift(db);
    expect(after?.jobs).toBe(before + 2);
  });

  it("suspects a portal change once enough reads fail across accounts, and does not throw without email set up", async () => {
    await logLayoutFailure(a, "2026-11-02", "payments:table");
    const result = await checkPortalDrift(db);
    expect(result?.suspected).toBe(true);
    expect(result?.accounts).toBeGreaterThanOrEqual(2);
  });

  it("ignores failures that are not layout failures", async () => {
    const before = (await checkPortalDrift(db))?.jobs ?? 0;
    const c = await createTestAccount("Drift C");
    const { job } = await enqueueJob(db, { accountId: c.accountId, type: "dpd_sync", franchiseId: c.franchiseId, reportDate: "2026-11-03", trigger: "schedule" });
    await sql(
      `insert into public.sync_logs (account_id, integration, import_job_id, franchise_id, level, event, message, detail)
       values ($1, 'dpd', $2, $3, 'warning', 'job_retry', 'Timed out.', $4::jsonb)`,
      [c.accountId, job.id, c.franchiseId, JSON.stringify({ kind: "network", step: "login", error: { message: "x" } })],
    );
    const result = await checkPortalDrift(db);
    expect(result?.jobs).toBe(before);
  });

  it("names the six-hour slot an alert falls in", () => {
    expect(sixHourBucket(new Date("2026-11-21T05:59:00Z"))).toBe("2026-11-21T00");
    expect(sixHourBucket(new Date("2026-11-21T06:00:00Z"))).toBe("2026-11-21T06");
    expect(sixHourBucket(new Date("2026-11-21T23:30:00Z"))).toBe("2026-11-21T18");
  });
});
