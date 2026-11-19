import "server-only";
import { londonToday, type ISODate } from "@/lib/dates";
import { fetchAll } from "@/lib/data/fetch-all";
import { enqueueJob } from "@/lib/jobs/queue";
import type { AdminClient } from "@/lib/supabase/admin";
import { periodContaining } from "@/lib/finance/periods";
import { buildCoverage } from "./coverage";
import { pickHistoryReads } from "./pick";
import { historyPeriods, historyWindow } from "./window";

/**
 * Past periods read per franchise per night. Each read takes about a minute of the worker's time, so the history fills in
 * over a few nights rather than in one long run that would hold up that evening's normal read.
 */
export const HISTORY_READS_PER_NIGHT = 6;

/** A period whose history read has failed this many times is left alone, so a lasting problem does not cost a read every night. */
export const HISTORY_FAILURE_LIMIT = 3;

/**
 * Queues reads of the Max plan's history (the current and previous tax year) for an account's active franchises: the newest
 * periods not yet read first, up to HISTORY_READS_PER_NIGHT per franchise. Safe to call repeatedly: periods already read,
 * queued, or not listed by DPD are skipped. The current period is left to the normal nightly read. Returns how many were queued.
 */
export async function queueHistoryReads(db: AdminClient, accountId: string, today: ISODate = londonToday(), limit = HISTORY_READS_PER_NIGHT, now: Date = new Date()): Promise<number> {
  const { data: franchises } = await db.from("franchises").select("id").eq("account_id", accountId).eq("is_active", true);
  if (!franchises?.length) return 0;

  // From the start of the oldest period in the window, which begins a few days before 6 April.
  const window = historyWindow(today);
  const jobs = await fetchAll(() =>
    db.from("import_jobs").select("id, franchise_id, report_date, status, result, payload, created_at")
      .eq("account_id", accountId).eq("job_type", "dpd_sync").gte("report_date", periodContaining(window.start).start).order("id"),
  );
  const coverage = buildCoverage(jobs.map((j) => ({ franchiseId: j.franchise_id, reportDate: j.report_date, status: j.status, result: j.result })));
  // Earlier reads of a period that failed outright, so a lasting problem is not retried every night.
  const failures = new Map<string, number>();
  for (const j of jobs) {
    if (j.status !== "failed" || !j.franchise_id || !j.report_date) continue;
    const key = `${j.franchise_id}|${periodContaining(j.report_date).start}`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
  }

  // The scheduler runs every few minutes through the evening; the limit is per night, so tonight's history reads count.
  const tonight = new Map<string, number>();
  const since = now.getTime() - 20 * 60 * 60_000;
  for (const j of jobs) {
    const isHistory = (j.payload as { history?: unknown } | null)?.history === true;
    if (!isHistory || !j.franchise_id || new Date(j.created_at).getTime() < since) continue;
    tonight.set(j.franchise_id, (tonight.get(j.franchise_id) ?? 0) + 1);
  }

  const picks = pickHistoryReads({
    franchiseIds: franchises.map((f) => f.id), periods: historyPeriods(today), coverage, failures, failureLimit: HISTORY_FAILURE_LIMIT, limit, alreadyTonight: tonight,
  });
  let queued = 0;
  for (const pick of picks) {
    const { alreadyQueued } = await enqueueJob(db, {
      accountId, type: "dpd_sync", franchiseId: pick.franchiseId, reportDate: pick.periodStart, trigger: "schedule", payload: { history: true },
    });
    if (!alreadyQueued) queued += 1;
  }
  return queued;
}
