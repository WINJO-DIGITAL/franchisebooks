import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, type ISODate } from "@/lib/dates";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export interface AttentionCount {
  alerts: number;
  reviews: number;
  files: number;
  /** The DPD sync failed, needs checking, or has not worked for two days. */
  dpd: boolean;
  total: number;
}

/**
 * Everything that needs a look, counted cheaply (four small queries) so the bell in the header can show it on every page.
 * "info" alerts are notes, not tasks, so they are not counted.
 */
export async function loadAttentionCount(db: Db, accountId: string, today: ISODate): Promise<AttentionCount> {
  const [alerts, reviews, files, job] = await Promise.all([
    db.from("anomalies").select("id", { count: "exact", head: true }).in("status", ["open", "investigating"]).neq("severity", "info"),
    db.from("review_items").select("id", { count: "exact", head: true }).eq("status", "open"),
    db.from("imported_files").select("id", { count: "exact", head: true }).eq("status", "needs_review"),
    db.from("import_jobs").select("status, finished_at").eq("account_id", accountId).eq("job_type", "dpd_sync").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const latest = job.data;
  let dpd: boolean;
  if (!latest) dpd = true;
  else if (latest.status === "queued" || latest.status === "running") dpd = false;
  else if (latest.status === "succeeded") dpd = (latest.finished_at ?? "").slice(0, 10) <= addDays(today, -2);
  else dpd = true;
  const counts = { alerts: alerts.count ?? 0, reviews: reviews.count ?? 0, files: files.count ?? 0, dpd };
  return { ...counts, total: counts.alerts + counts.reviews + counts.files + (dpd ? 1 : 0) };
}
