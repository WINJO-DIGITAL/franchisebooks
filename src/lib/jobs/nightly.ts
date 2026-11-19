/**
 * Makes the nightly DPD sync dependable.
 *
 * GitHub's own scheduled runs are often late or skipped. So the website's scheduler (Vercel Cron, every 5 minutes) also
 * starts the GitHub workflow, through the same GITHUB_SYNC_TOKEN dispatch the "Sync DPD" button uses, as soon as the
 * night's reads are queued. A late GitHub run is harmless: it finds the work done, or does what is still waiting.
 *
 *   • Idempotent: each franchise's read is queued at most once a night (by the scheduler tick), and the workflow is only
 *     started while a read is waiting, no more than once every half hour and at most MAX_DISPATCHES_PER_NIGHT times.
 *   • If a franchise has no successful read by 23:00 UK time, the owner is emailed once and it is written to the sync log.
 */

import "server-only";
import { addDays, formatUkDate, londonMinutesOfDay, londonToday, parseTimeToMinutes, type ISODate } from "@/lib/dates";
import { startWorkerRun, type DispatchResult } from "@/lib/github/dispatch";
import { logger } from "@/lib/logger";
import { sendAlert } from "@/lib/notify/alerts";
import { ownerEmail } from "@/lib/notify/email";
import type { AdminClient } from "@/lib/supabase/admin";
import { WORKER_JOB_TYPES } from "./queue";

export const MAX_DISPATCHES_PER_NIGHT = 4;
export const DISPATCH_GAP_MINUTES = 30;
/** Before this UK time a run still belongs to the night before (late runs after midnight). */
const NIGHT_ENDS_AT = 6 * 60;

/** The UK evening a moment belongs to: until 06:00 it is still the previous night. */
export function syncNight(now: Date, timeZone = "Europe/London"): ISODate {
  const today = londonToday(now, timeZone);
  return londonMinutesOfDay(now, timeZone) < NIGHT_ENDS_AT ? addDays(today, -1) : today;
}

export interface DispatchDecision {
  dispatch: boolean;
  reason: string;
  attempt?: number;
}

/** Pure: whether to start the workflow now, given what is waiting and the dispatches already made tonight. */
export function decideDispatch(input: { waiting: number; running: number; previous: { attempt: number; dispatchedAt: Date; started: boolean }[]; now: Date }): DispatchDecision {
  if (input.waiting === 0) return { dispatch: false, reason: "Nothing is waiting." };
  if (input.running > 0) return { dispatch: false, reason: "A sync run is already working." };
  if (input.previous.length >= MAX_DISPATCHES_PER_NIGHT) return { dispatch: false, reason: `Already started ${input.previous.length} times tonight.` };
  const last = input.previous.reduce<Date | null>((latest, p) => (!latest || p.dispatchedAt > latest ? p.dispatchedAt : latest), null);
  // A run that was started takes a few minutes to begin; one that could not be started can be tried again sooner.
  const lastStarted = input.previous.find((p) => p.dispatchedAt.getTime() === last?.getTime())?.started ?? false;
  const gap = (lastStarted ? DISPATCH_GAP_MINUTES : 5) * 60_000;
  if (last && input.now.getTime() - last.getTime() < gap) return { dispatch: false, reason: "Started recently; giving it time." };
  return { dispatch: true, reason: "Reads are waiting.", attempt: input.previous.reduce((max, p) => Math.max(max, p.attempt), 0) + 1 };
}

/**
 * Starts the GitHub sync workflow if DPD reads are waiting and it has not just been started. Never throws.
 * Returns what it decided, for the cron response and the logs.
 */
export async function ensureNightlyWorkerRun(
  db: AdminClient,
  now: Date = new Date(),
  start: () => Promise<DispatchResult> = () => startWorkerRun(),
): Promise<DispatchDecision & { started?: boolean }> {
  try {
    const nowIso = now.toISOString();
    // Jobs queued in the last few minutes are left alone: whoever queued them (the "Sync DPD" button) has started a run already.
    const settled = new Date(now.getTime() - 5 * 60_000).toISOString();
    const night = syncNight(now);
    const [{ count: waiting }, { count: running }, { data: previous }] = await Promise.all([
      db.from("import_jobs").select("id", { count: "exact", head: true }).eq("status", "queued").in("job_type", WORKER_JOB_TYPES).lte("run_after", nowIso).lte("created_at", settled),
      // A job left "running" by a run that died long ago does not count (the scheduler returns those to the queue).
      db.from("import_jobs").select("id", { count: "exact", head: true }).eq("status", "running").in("job_type", WORKER_JOB_TYPES)
        .gte("locked_at", new Date(now.getTime() - 45 * 60_000).toISOString()),
      db.from("sync_dispatches").select("attempt, dispatched_at, started").eq("night", night),
    ]);
    const decision = decideDispatch({
      waiting: waiting ?? 0,
      running: running ?? 0,
      previous: (previous ?? []).map((p) => ({ attempt: p.attempt, dispatchedAt: new Date(p.dispatched_at), started: p.started })),
      now,
    });
    if (!decision.dispatch || !decision.attempt) return decision;
    // Claim the attempt first: if two ticks run together, only one insert succeeds and only that one starts the run.
    const { error: claimError } = await db.from("sync_dispatches").insert({ night, attempt: decision.attempt, dispatched_at: nowIso });
    if (claimError) return { dispatch: false, reason: "Another tick is starting it." };
    const result = await start();
    await db.from("sync_dispatches").update({ started: result.started, message: result.started ? "Started." : result.message })
      .eq("night", night).eq("attempt", decision.attempt);
    logger.info({ night, attempt: decision.attempt, started: result.started }, result.started ? "Started the nightly sync run" : "Could not start the nightly sync run");
    return { ...decision, started: result.started };
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "nightly dispatch check failed");
    return { dispatch: false, reason: "The check could not be made." };
  }
}

/** Pure: the UK time (minutes after midnight) by which tonight's sync should have succeeded: 23:00, or an hour after a late sync time. */
export function missedSyncDeadline(syncTimeLocal: string): number {
  const syncAt = parseTimeToMinutes(syncTimeLocal) ?? 20 * 60 + 30;
  return Math.min(Math.max(23 * 60, syncAt + 60), 23 * 60 + 55);
}

/**
 * After the deadline, checks every active franchise has a successful DPD read for tonight. If any has not, writes a
 * warning to the sync log and emails the owner, once a night. Returns the FD numbers still missing.
 */
export async function checkMissedSync(
  db: AdminClient,
  input: { accountId: string; reportDate: ISODate; franchises: { id: string; fd_number: string }[] },
  now: Date = new Date(),
): Promise<string[]> {
  if (input.franchises.length === 0) return [];
  const { data: done } = await db.from("import_jobs").select("franchise_id").eq("account_id", input.accountId).eq("job_type", "dpd_sync")
    .eq("report_date", input.reportDate).in("status", ["succeeded", "partial"]);
  const succeeded = new Set((done ?? []).map((j) => j.franchise_id));
  const missing = input.franchises.filter((f) => !succeeded.has(f.id)).map((f) => f.fd_number).sort();
  if (missing.length === 0) return [];

  const { count: logged } = await db.from("sync_logs").select("id", { count: "exact", head: true }).eq("account_id", input.accountId)
    .eq("event", "nightly_sync_missing").contains("detail", { reportDate: input.reportDate });
  if ((logged ?? 0) > 0) return missing;

  const when = formatUkDate(input.reportDate);
  const message = `No successful DPD read yet for ${when}: ${missing.join(", ")}. It will keep trying tonight; you can also press "Sync DPD" in Data & Integrations.`;
  await db.from("sync_logs").insert({ account_id: input.accountId, integration: "dpd", level: "warning", event: "nightly_sync_missing", message, detail: { reportDate: input.reportDate, missing } });
  const to = await ownerEmail(db, input.accountId).catch(() => null);
  await sendAlert(db, {
    key: `nightly-sync-missing:${input.accountId}`,
    bucket: input.reportDate,
    to,
    subject: `Franchise Books: tonight's DPD read has not finished (${when})`,
    text: `By 23:00 there was still no successful read of your DPD account for ${when}.\n\nFranchise${missing.length === 1 ? "" : "s"} not read yet: ${missing.join(", ")}.\n\nIt will keep trying tonight. You can also open Data & Integrations in Franchise Books and press "Sync DPD". Nothing has been changed on the DPD side.`,
  }, now).catch(() => "not_sent");
  logger.warn({ accountId: input.accountId, reportDate: input.reportDate, missing }, "nightly DPD sync missing");
  return missing;
}
