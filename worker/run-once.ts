/**
 * One-shot worker, for GitHub Actions (or any scheduler that starts a process,
 * runs it, and stops it).
 *
 * Does the same work as the always-on worker, then exits:
 *
 *   1. Queues what is due (the evening DPD sync for each active franchise, a
 *      Dropbox catch-up, the daily checks). Every decision is "queue it unless
 *      it already exists", so running this twice never doubles anything up.
 *   2. Runs the queued jobs. A failed job is re-queued with a delay (2 then 8
 *      minutes); this process waits for those retries, up to a time limit.
 *   3. Releases the browser, writes a summary, and exits non-zero if any job
 *      ended failed or blocked, so the owner is told.
 *
 * Options:
 *   --force          queue a DPD sync for every active franchise now, whatever the time
 *   --date YYYY-MM-DD  the report date for --force (default: today, UK time)
 *   --discovery      queue a read-only portal exploration instead of a sync
 *   --max-minutes N  stop waiting for retries after N minutes (default 25)
 */

import { appendFileSync } from "node:fs";
import { hostname } from "node:os";
import { isISODate, londonToday } from "@/lib/dates";
import { PortalSessionPool } from "@/lib/dpd/sync";
import { APP_JOB_TYPES, WORKER_JOB_TYPES, enqueueJob, type JobType } from "@/lib/jobs/queue";
import { drainJobs, runSchedulerTick } from "@/lib/jobs/run";
import { describeError, logger, reportError } from "@/lib/logger";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";

process.env.SERVICE_NAME ??= "worker-actions";

const TYPES: JobType[] = [...WORKER_JOB_TYPES, ...APP_JOB_TYPES];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : null;
}

/** Queues a manual DPD sync (or portal exploration) for every active franchise. */
async function queueManual(db: AdminClient, kind: "dpd_sync" | "dpd_discovery", reportDate: string): Promise<number> {
  const { data: accounts, error } = await db.from("app_settings").select("account_id");
  if (error) throw new Error(`Could not read accounts: ${error.message}`);
  let queued = 0;
  for (const { account_id: accountId } of accounts ?? []) {
    if (kind === "dpd_discovery") {
      await enqueueJob(db, { accountId, type: "dpd_discovery", trigger: "manual" });
      queued += 1;
      continue;
    }
    const { data: franchises } = await db.from("franchises").select("id").eq("account_id", accountId).eq("is_active", true);
    for (const franchise of franchises ?? []) {
      await enqueueJob(db, { accountId, type: "dpd_sync", franchiseId: franchise.id, reportDate, trigger: "manual" });
      queued += 1;
    }
  }
  return queued;
}

/** The soonest time a queued job of ours becomes runnable again (a retry waiting out its delay), if before the deadline. */
async function nextRetryAt(db: AdminClient, deadline: number): Promise<number | null> {
  const { data } = await db.from("import_jobs").select("run_after").eq("status", "queued").in("job_type", TYPES).order("run_after", { ascending: true }).limit(1);
  const at = data?.[0]?.run_after ? new Date(data[0].run_after).getTime() : null;
  return at !== null && at <= deadline ? at : null;
}

async function main(): Promise<number> {
  const startedAt = new Date();
  const maxMinutes = Number(option("max-minutes") ?? 25);
  const deadline = Date.now() + (Number.isFinite(maxMinutes) && maxMinutes > 0 ? maxMinutes : 25) * 60_000;
  const workerId = `actions-${hostname()}-${process.pid}`;
  const db = createAdminClient();
  const pool = new PortalSessionPool();

  const requestedDate = option("date");
  if (requestedDate && !isISODate(requestedDate)) {
    logger.fatal({ requestedDate }, "--date must look like 2026-11-17");
    return 1;
  }

  let ran = 0;
  try {
    if (flag("discovery")) {
      logger.info({ queued: await queueManual(db, "dpd_discovery", londonToday()) }, "Queued portal exploration");
    } else if (flag("force")) {
      logger.info({ queued: await queueManual(db, "dpd_sync", requestedDate ?? londonToday()), date: requestedDate ?? londonToday() }, "Queued manual DPD sync");
    } else {
      const tick = await runSchedulerTick(db);
      logger.info(tick, "Scheduler tick");
    }

    // Run everything that is due, then wait out any retry delay that fits inside the time limit.
    for (;;) {
      ran += await drainJobs(db, { workerId, types: TYPES, maxJobs: 50, deadline, portalPool: pool });
      const retryAt = await nextRetryAt(db, deadline);
      if (retryAt === null) break;
      const wait = Math.max(0, retryAt - Date.now()) + 1000;
      logger.info({ seconds: Math.round(wait / 1000) }, "A job is waiting to retry; waiting for it");
      await sleep(wait);
    }
  } catch (error) {
    await reportError(error, { where: "worker.run-once" });
    return 1;
  } finally {
    // Never leave a signed-in portal session open.
    await pool.release().catch(() => undefined);
  }

  // Outcome: anything this run finished as failed or blocked, and anything still waiting to retry.
  const since = new Date(startedAt.getTime() - 1000).toISOString();
  const [{ data: bad }, { data: waiting }, { data: good }] = await Promise.all([
    db.from("import_jobs").select("job_type, status, error_message, franchise_id, report_date").gte("finished_at", since).in("status", ["failed", "blocked"]),
    db.from("import_jobs").select("job_type, error_message, run_after").eq("status", "queued").in("job_type", TYPES),
    db.from("import_jobs").select("job_type, status, result").gte("finished_at", since).in("status", ["succeeded", "partial"]),
  ]);
  const seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);

  const lines = [
    "## DPD sync run",
    "",
    `Finished in ${Math.floor(seconds / 60)} min ${seconds % 60} s. Jobs run: ${ran}.`,
    "",
    `* Succeeded or partly succeeded: ${good?.length ?? 0}`,
    `* Failed or blocked: ${bad?.length ?? 0}`,
    `* Still queued for a later retry: ${waiting?.length ?? 0}`,
    ...(bad ?? []).map((j) => `  * ${j.job_type} (${j.status}): ${j.error_message ?? "no message"}`),
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);

  if ((bad?.length ?? 0) > 0) return 1;
  if ((waiting?.length ?? 0) > 0) console.log("::notice::A job is still waiting to retry. The next scheduled run will pick it up.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(describeError(error));
    process.exit(1);
  });
