import "server-only";
import { londonToday } from "@/lib/dates";
import { enqueueJob } from "@/lib/jobs/queue";
import { pokeWorker } from "@/lib/jobs/run";
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
  await pokeWorker(); // not fatal: the worker also polls on its own timer
  return queued;
}
