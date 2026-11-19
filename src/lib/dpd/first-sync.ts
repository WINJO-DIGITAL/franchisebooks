import "server-only";
import { londonToday } from "@/lib/dates";
import { accountPlan } from "@/lib/billing/plan";
import { queueHistoryReads } from "@/lib/history/backfill";
import { enqueueJob } from "@/lib/jobs/queue";
import { startWorkerRun } from "@/lib/github/dispatch";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * Queues a DPD read for each of an account's active franchises right now, and wakes the worker, so a new customer's
 * dashboard fills in straight away instead of waiting for the evening sync. Safe to repeat: a franchise that already has
 * a read queued or running is not queued twice. Returns how many franchises were queued.
 */
export async function queueFirstSync(db: AdminClient, accountId: string, userId: string): Promise<number> {
  const { data: franchises } = await db.from("franchises").select("id").eq("account_id", accountId).eq("is_active", true);
  const today = londonToday();
  let queued = 0;
  for (const franchise of franchises ?? []) {
    const { alreadyQueued } = await enqueueJob(db, { accountId, type: "dpd_sync", franchiseId: franchise.id, reportDate: today, trigger: "manual", requestedBy: userId });
    if (!alreadyQueued) queued += 1;
  }
  // Max plan: the first few past periods too, queued after the current period so it is read first.
  if ((await accountPlan(db, accountId)) === "max") await queueHistoryReads(db, accountId, today);
  await startWorkerRun(); // not fatal: the next scheduled run also picks the jobs up
  return queued;
}
