/**
 * Job queue helpers. Jobs live in the `import_jobs` table; a unique index
 * guarantees that only one job per type, franchise and report date can be
 * queued or running at a time, so schedules, retries and manual "Sync now"
 * presses can never overlap or double up.
 */

import "server-only";
import { describeError } from "@/lib/logger";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type { JsonObject } from "@/lib/supabase/json";

export type Job = Database["public"]["Tables"]["import_jobs"]["Row"];
export type JobType = "dpd_sync" | "dpd_discovery" | "dropbox_sync" | "file_import" | "anomaly_scan" | "monthly_report";

/** Jobs that need a real browser and therefore run on the background worker, not on Vercel. */
export const WORKER_JOB_TYPES: JobType[] = ["dpd_sync", "dpd_discovery"];
/** Jobs light enough to run inside a web request or cron invocation. */
export const APP_JOB_TYPES: JobType[] = ["dropbox_sync", "anomaly_scan", "monthly_report"];

export interface EnqueueInput {
  accountId: string;
  type: JobType;
  franchiseId?: string | null;
  reportDate?: string | null;
  trigger: "schedule" | "manual" | "webhook" | "retry";
  payload?: Record<string, unknown>;
  requestedBy?: string | null;
}

/** Queues a job, or returns the identical job that is already queued or running. */
export async function enqueueJob(db: AdminClient, input: EnqueueInput): Promise<{ job: Job; alreadyQueued: boolean }> {
  const before = new Date(Date.now() - 2000).toISOString();
  const { data, error } = await db.rpc("enqueue_job", {
    p_account_id: input.accountId,
    p_job_type: input.type,
    p_franchise_id: (input.franchiseId ?? null) as string,
    p_report_date: (input.reportDate ?? null) as string,
    p_trigger: input.trigger,
    p_payload: (input.payload ?? {}) as JsonObject,
    p_requested_by: (input.requestedBy ?? null) as string,
  });
  if (error || !data) throw new Error(`Could not queue the job: ${error?.message ?? "no job returned"}`);
  const job = data as Job;
  return { job, alreadyQueued: job.created_at < before || job.status === "running" };
}

export async function claimNextJob(db: AdminClient, workerId: string, types: JobType[]): Promise<Job | null> {
  const { data, error } = await db.rpc("claim_next_job", { p_worker: workerId, p_types: types });
  if (error) throw new Error(`Could not claim a job: ${error.message}`);
  return (data as Job[] | null)?.[0] ?? null;
}

export interface JobOutcome {
  status: "succeeded" | "partial" | "blocked";
  /** Plain-English summary shown to the owner. */
  message: string;
  result?: Record<string, unknown>;
}

export async function completeJob(db: AdminClient, job: Job, outcome: JobOutcome): Promise<void> {
  await db.from("import_jobs").update({
    status: outcome.status,
    finished_at: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    result: { message: outcome.message, ...(outcome.result ?? {}) } as JsonObject,
    error_message: outcome.status === "succeeded" ? null : outcome.message,
  }).eq("id", job.id);
}

/** Exponential backoff: 2, 8, 32 minutes… */
export function retryDelayMinutes(attempt: number): number {
  return Math.min(2 * 4 ** Math.max(0, attempt - 1), 120);
}

/**
 * Records a failure. The same job row is re-queued with a delay until it runs
 * out of attempts — retries never create a second job, and because imports
 * are idempotent a retry can never duplicate data.
 */
export async function failJob(db: AdminClient, job: Job, error: unknown, plainEnglish: string, options: { retryable?: boolean } = {}): Promise<{ willRetry: boolean }> {
  const willRetry = (options.retryable ?? true) && job.attempts < job.max_attempts;
  const detail = describeError(error, { attempt: job.attempts });
  await db.from("import_jobs").update({
    status: willRetry ? "queued" : "failed",
    run_after: willRetry ? new Date(Date.now() + retryDelayMinutes(job.attempts) * 60_000).toISOString() : job.run_after,
    finished_at: willRetry ? null : new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    error_message: willRetry ? `${plainEnglish} It will be tried again automatically.` : plainEnglish,
    error_detail: detail as unknown as JsonObject,
  }).eq("id", job.id);
  return { willRetry };
}
