/**
 * Runs queued jobs and the scheduler tick. Shared by the web app (light jobs,
 * inside cron or a manual request) and the worker (everything, including the
 * browser-based DPD jobs).
 */

import "server-only";
import { runAnomalyScan } from "@/lib/anomalies/run";
import { addDays, isISODate, isYearMonth, londonToday, monthOf, monthRange } from "@/lib/dates";
import { lastCompletedPeriod, type DpdPeriod } from "@/lib/finance/periods";
import { runDropboxSync } from "@/lib/dropbox/sync";
import { PortalError } from "@/lib/dpd/errors";
import type { PortalSessionPool } from "@/lib/dpd/sync";
import { env } from "@/lib/env";
import { describeError, logger, reportError } from "@/lib/logger";
import { generateMonthlyReport } from "@/lib/reports/generate";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";
import { claimNextJob, completeJob, enqueueJob, failJob, WORKER_JOB_TYPES, type Job, type JobOutcome, type JobType } from "./queue";
import { decideSchedule } from "./schedule";

export interface RunContext {
  /** Present only on the worker: needed for DPD portal jobs. */
  portalPool?: PortalSessionPool;
  deadline?: number;
}

async function execute(db: AdminClient, job: Job, ctx: RunContext): Promise<JobOutcome> {
  switch (job.job_type as JobType) {
    case "dpd_sync": {
      if (!ctx.portalPool) throw new PortalError("config", "runner", "DPD sync can only run on the background worker.");
      const { runDpdSyncJob } = await import("@/lib/dpd/sync");
      return runDpdSyncJob(db, job, ctx.portalPool);
    }
    case "dpd_discovery": {
      if (!ctx.portalPool) throw new PortalError("config", "runner", "Portal discovery can only run on the background worker.");
      const { runDpdDiscoveryJob } = await import("@/lib/dpd/sync");
      return runDpdDiscoveryJob(db, job);
    }
    case "dropbox_sync": {
      const result = await runDropboxSync(db, job.account_id, { importJobId: job.id, deadline: ctx.deadline });
      return { status: result.status, message: result.message, result: { ...result } };
    }
    case "anomaly_scan": {
      const to = job.report_date ?? londonToday();
      const from = String((job.payload as { from?: string } | null)?.from ?? addDays(to, -7));
      const scan = await runAnomalyScan(db, job.account_id, { from, to });
      return { status: "succeeded", message: scan.created === 0 ? "Checked for anything unusual: nothing new." : `Checked for anything unusual: ${scan.created} new alert${scan.created === 1 ? "" : "s"}.`, result: { ...scan } };
    }
    case "monthly_report": {
      // A report is for a calendar month, or (when payload has periodStart and periodEnd) a DPD four-week period.
      const payload = (job.payload ?? {}) as { month?: string; periodStart?: string; periodEnd?: string };
      const period: DpdPeriod | null = isISODate(payload.periodStart) && isISODate(payload.periodEnd) ? { start: payload.periodStart, end: payload.periodEnd } : null;
      const month = period ? monthOf(period.start) : String(payload.month ?? "");
      if (!isYearMonth(month)) throw new Error("report job has no valid month or period");
      // A period report must not be made from stale figures: wait until a DPD sync has succeeded since the period closed.
      if (period) {
        const { data: connection } = await db.from("integration_connections").select("config").eq("account_id", job.account_id).eq("provider", "dpd").maybeSingle();
        if ((connection?.config as { portalMap?: unknown } | null)?.portalMap) {
          const closed = addDays(period.end, 1);
          const { count: synced } = await db.from("import_jobs").select("id", { count: "exact", head: true })
            .eq("account_id", job.account_id).eq("job_type", "dpd_sync").in("status", ["succeeded", "partial"]).gte("report_date", closed);
          if ((synced ?? 0) === 0) throw new Error(`The report for ${period.start} to ${period.end} is waiting for a DPD sync after the period closed.`);
        }
      }
      const generated: string[] = [];
      const { data: franchises } = await db.from("franchises").select("id").eq("account_id", job.account_id).eq("is_active", true);
      const scopes: (string | null)[] = [null, ...(franchises ?? []).map((f) => f.id)];
      for (const franchiseId of scopes.length === 2 ? [scopes[1]!] : scopes) {
        const report = await generateMonthlyReport(db, { accountId: job.account_id, month, period, franchiseId, trigger: "auto" });
        generated.push(report.label);
      }
      return { status: "succeeded", message: `Report${generated.length === 1 ? "" : "s"} generated: ${generated.join("; ")}.`, result: { generated } };
    }
    default:
      throw new Error(`Unknown job type ${job.job_type}`);
  }
}

export async function runJob(db: AdminClient, job: Job, ctx: RunContext): Promise<void> {
  const started = Date.now();
  try {
    const outcome = await execute(db, job, ctx);
    await completeJob(db, job, outcome);
    // A Dropbox run that hit its per-run limit carries on in a fresh job.
    if (job.job_type === "dropbox_sync" && outcome.result?.moreToDo === true) {
      await enqueueJob(db, { accountId: job.account_id, type: "dropbox_sync", trigger: "retry" });
    }
    logger.info({ jobId: job.id, type: job.job_type, status: outcome.status, ms: Date.now() - started }, outcome.message);
  } catch (error) {
    const portal = error instanceof PortalError ? error : null;
    const plain = portal?.plainEnglish ?? "The job could not be completed.";
    if (portal && (portal.kind === "blocked" || portal.kind === "config" || portal.kind === "auth")) {
      // Will not fix itself: stop here and tell the owner what to do instead of retrying.
      await db.from("import_jobs").update({
        status: "blocked", finished_at: new Date().toISOString(), locked_at: null, locked_by: null,
        error_message: plain, error_detail: describeError(error, { step: portal.step, kind: portal.kind }) as unknown as JsonObject,
      }).eq("id", job.id);
      await db.from("sync_logs").insert({
        account_id: job.account_id, integration: job.job_type.startsWith("dpd") ? "dpd" : "system", import_job_id: job.id, franchise_id: job.franchise_id,
        level: "warning", event: "job_blocked", message: plain, detail: { step: portal.step, kind: portal.kind } as JsonObject,
      });
    } else {
      const { willRetry } = await failJob(db, job, error, plain, { retryable: portal ? portal.retryable : true });
      await db.from("sync_logs").insert({
        account_id: job.account_id, integration: job.job_type.startsWith("dpd") ? "dpd" : job.job_type === "dropbox_sync" ? "dropbox" : "system",
        import_job_id: job.id, franchise_id: job.franchise_id, level: willRetry ? "warning" : "error", event: willRetry ? "job_retry" : "job_failed",
        message: willRetry ? `${plain} It will be tried again automatically.` : plain,
        detail: { error: describeError(error, portal ? { step: portal.step } : {}) } as unknown as JsonObject,
      });
      if (!willRetry) await reportError(error, { jobId: job.id, type: job.job_type });
    }
    logger.warn({ jobId: job.id, type: job.job_type, err: describeError(error) }, "Job did not complete");
  }
}

/** Claims and runs queued jobs of the given types until none are left or a limit is reached. */
export async function drainJobs(
  db: AdminClient,
  options: { workerId: string; types: JobType[]; maxJobs?: number; deadline?: number; portalPool?: PortalSessionPool },
): Promise<number> {
  let ran = 0;
  const max = options.maxJobs ?? 20;
  while (ran < max && (!options.deadline || Date.now() < options.deadline)) {
    const job = await claimNextJob(db, options.workerId, options.types);
    if (!job) break;
    await runJob(db, job, { portalPool: options.portalPool, deadline: options.deadline });
    ran += 1;
  }
  return ran;
}

export interface TickResult {
  accounts: number;
  queued: { dpdSync: number; dropboxSync: number; anomalyScan: number; monthlyReport: number };
  released: number;
}

/**
 * The scheduler tick. Safe to call as often as you like and from several
 * places at once: every decision is "queue it unless it already exists".
 */
export async function runSchedulerTick(db: AdminClient, now: Date = new Date()): Promise<TickResult> {
  const result: TickResult = { accounts: 0, queued: { dpdSync: 0, dropboxSync: 0, anomalyScan: 0, monthlyReport: 0 }, released: 0 };
  const { data: released } = await db.rpc("release_stale_jobs", { p_older_than: "45 minutes" });
  result.released = Number(released ?? 0);

  const { data: settingsRows, error } = await db.from("app_settings").select("account_id, sync_enabled, sync_time_local, sync_timezone, auto_monthly_reports, report_frequency");
  if (error) throw new Error(`Could not read schedules: ${error.message}`);

  for (const settings of settingsRows ?? []) {
    result.accounts += 1;
    const accountId = settings.account_id;
    const decision = decideSchedule({ syncEnabled: settings.sync_enabled, syncTimeLocal: settings.sync_time_local, syncTimezone: settings.sync_timezone }, now);

    const [{ data: connections }, { data: franchises }] = await Promise.all([
      db.from("integration_connections").select("provider, status, config, last_sync_at").eq("account_id", accountId),
      db.from("franchises").select("id").eq("account_id", accountId).eq("is_active", true),
    ]);
    const dpd = connections?.find((c) => c.provider === "dpd");
    const dropbox = connections?.find((c) => c.provider === "dropbox");
    const dpdReady = Boolean((dpd?.config as { portalMap?: unknown } | null)?.portalMap);

    if (decision.syncDue) {
      // Evening DPD sync: once per franchise per day, and only when the portal has actually been set up.
      if (dpdReady) {
        for (const franchise of franchises ?? []) {
          const { count } = await db.from("import_jobs").select("id", { count: "exact", head: true })
            .eq("account_id", accountId).eq("job_type", "dpd_sync").eq("franchise_id", franchise.id).eq("report_date", decision.reportDate).eq("trigger", "schedule");
          if ((count ?? 0) === 0) {
            await enqueueJob(db, { accountId, type: "dpd_sync", franchiseId: franchise.id, reportDate: decision.reportDate, trigger: "schedule" });
            result.queued.dpdSync += 1;
          }
        }
      }
      // Daily check for missing reports and anything unusual (runs whether or not DPD sync is set up).
      const { count: scans } = await db.from("import_jobs").select("id", { count: "exact", head: true })
        .eq("account_id", accountId).eq("job_type", "anomaly_scan").eq("report_date", decision.reportDate);
      if ((scans ?? 0) === 0 && (franchises?.length ?? 0) > 0) {
        await enqueueJob(db, { accountId, type: "anomaly_scan", reportDate: decision.reportDate, trigger: "schedule", payload: { from: addDays(decision.reportDate, -7) } });
        result.queued.anomalyScan += 1;
      }
    }

    // Dropbox reconciliation (a fallback for missed webhooks): at most every 30 minutes.
    if (dropbox && (dropbox.status === "connected" || dropbox.status === "error")) {
      const last = dropbox.last_sync_at ? new Date(dropbox.last_sync_at).getTime() : 0;
      if (now.getTime() - last > 30 * 60_000) {
        const { alreadyQueued } = await enqueueJob(db, { accountId, type: "dropbox_sync", trigger: "schedule" });
        if (!alreadyQueued) result.queued.dropboxSync += 1;
      }
    }

    // Automatic reports. With report_frequency "dpd_period": one for each DPD four-week period, made on the Monday after it
    // ends (its last day is a Sunday, so the day after is the Monday). Otherwise one for each calendar month, from the 2nd.
    if (settings.auto_monthly_reports && settings.report_frequency === "dpd_period" && (franchises?.length ?? 0) > 0) {
      const period = lastCompletedPeriod(londonToday(now));
      const [{ count: existing }, { count: activity }, { count: jobs }] = await Promise.all([
        db.from("monthly_reports").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("period_start", period.start).eq("trigger", "auto"),
        db.from("daily_earnings").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("is_current", true).gte("report_date", period.start).lte("report_date", period.end),
        db.from("import_jobs").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("job_type", "monthly_report").eq("report_date", period.start).in("status", ["queued", "running", "succeeded", "partial"]),
      ]);
      if ((existing ?? 0) === 0 && (jobs ?? 0) === 0 && (activity ?? 0) > 0) {
        await enqueueJob(db, { accountId, type: "monthly_report", reportDate: period.start, trigger: "schedule", payload: { periodStart: period.start, periodEnd: period.end } });
        result.queued.monthlyReport += 1;
      }
    } else if (settings.auto_monthly_reports && decision.reportMonthDue && (franchises?.length ?? 0) > 0) {
      const month = decision.reportMonthDue;
      const [{ count: existing }, { count: activity }, { count: jobs }] = await Promise.all([
        db.from("monthly_reports").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("report_month", `${month}-01`).eq("trigger", "auto"),
        db.from("daily_earnings").select("id", { count: "exact", head: true }).eq("account_id", accountId).gte("report_date", monthRange(month).start).lte("report_date", monthRange(month).end),
        db.from("import_jobs").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("job_type", "monthly_report").eq("report_date", `${month}-01`),
      ]);
      if ((existing ?? 0) === 0 && (jobs ?? 0) === 0 && (activity ?? 0) > 0 && month < monthOf(londonToday(now))) {
        await enqueueJob(db, { accountId, type: "monthly_report", reportDate: `${month}-01`, trigger: "schedule", payload: { month } });
        result.queued.monthlyReport += 1;
      }
    }
  }
  return result;
}

/** Tells the worker there is work waiting. Failure is not fatal: the worker also polls on its own timer. */
export async function pokeWorker(): Promise<{ ok: boolean; reason?: string }> {
  const url = env.workerUrl();
  const token = env.workerAuthToken();
  if (!url || !token) return { ok: false, reason: "The background worker is not configured." };
  try {
    const response = await fetch(`${url}/run`, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    return response.ok ? { ok: true } : { ok: false, reason: `The background worker answered with status ${response.status}.` };
  } catch (error) {
    return { ok: false, reason: `The background worker could not be reached (${describeError(error).message}).` };
  }
}

export function queuedWorkerJobTypes(): JobType[] {
  return WORKER_JOB_TYPES;
}
