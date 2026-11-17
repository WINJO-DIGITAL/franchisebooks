import type { SupabaseClient } from "@supabase/supabase-js";
import { formatRelative } from "@/lib/dates";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

export interface IntegrationStatus {
  key: "dpd" | "dropbox";
  name: string;
  tone: "good" | "warn" | "bad" | "info";
  /** Plain-English one-liner, e.g. "DPD synchronised successfully." */
  headline: string;
  detail: string;
  lastSuccessAt: string | null;
  running: boolean;
}

export interface SyncOverview {
  dpd: IntegrationStatus;
  dropbox: IntegrationStatus;
  reviewCount: number;
  failedFiles: number;
  lastImportAt: string | null;
}

/** Summarises the state of each integration in the words the owner will read. */
export async function loadSyncOverview(db: Db, accountId: string): Promise<SyncOverview> {
  const [dpdJobs, dpdConnection, dropboxConnection, dropboxJob, reviews, failed, lastFile] = await Promise.all([
    db.from("import_jobs").select("id, status, created_at, finished_at, error_message, result, report_date, job_type")
      .eq("account_id", accountId).eq("job_type", "dpd_sync").order("created_at", { ascending: false }).limit(20),
    db.from("integration_connections").select("status, config, last_success_at, last_error").eq("account_id", accountId).eq("provider", "dpd").maybeSingle(),
    db.from("integration_connections").select("status, display_name, last_success_at, last_sync_at, last_error").eq("account_id", accountId).eq("provider", "dropbox").maybeSingle(),
    db.from("import_jobs").select("status").eq("account_id", accountId).eq("job_type", "dropbox_sync").in("status", ["queued", "running"]).limit(1),
    db.from("review_items").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", "open"),
    db.from("imported_files").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", "failed"),
    db.from("imported_files").select("created_at").eq("account_id", accountId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const jobs = dpdJobs.data ?? [];
  const latest = jobs[0];
  const lastSuccess = jobs.find((j) => j.status === "succeeded" || j.status === "partial");
  const running = jobs.some((j) => j.status === "queued" || j.status === "running");
  const hasPortalMap = Boolean((dpdConnection.data?.config as { portalMap?: unknown } | null)?.portalMap);

  let dpd: IntegrationStatus;
  if (running) {
    dpd = { key: "dpd", name: "DPD portal", tone: "info", headline: "DPD sync is running…", detail: "This usually takes a few minutes.", lastSuccessAt: lastSuccess?.finished_at ?? null, running: true };
  } else if (!latest) {
    dpd = {
      key: "dpd", name: "DPD portal", tone: "warn", running: false, lastSuccessAt: null,
      headline: hasPortalMap ? "DPD has not been synchronised yet." : "DPD portal connection is not set up yet.",
      detail: hasPortalMap ? "It runs automatically every evening. Sync DPD queues a run for the next evening sync." : "Until it is, upload reports by hand.",
    };
  } else if (latest.status === "succeeded") {
    dpd = { key: "dpd", name: "DPD portal", tone: "good", headline: "DPD synchronised successfully.", detail: `Last sync ${formatRelative(latest.finished_at)}.`, lastSuccessAt: latest.finished_at, running: false };
  } else if (latest.status === "partial") {
    dpd = { key: "dpd", name: "DPD portal", tone: "warn", headline: "DPD synchronised, but some reports need checking.", detail: latest.error_message ?? "", lastSuccessAt: latest.finished_at, running: false };
  } else if (latest.status === "blocked") {
    dpd = { key: "dpd", name: "DPD portal", tone: "warn", headline: "DPD sync could not run.", detail: latest.error_message ?? "The portal blocked automatic access.", lastSuccessAt: lastSuccess?.finished_at ?? null, running: false };
  } else {
    dpd = { key: "dpd", name: "DPD portal", tone: "bad", headline: "The last DPD sync failed.", detail: latest.error_message ?? "Please try again, or upload the reports by hand.", lastSuccessAt: lastSuccess?.finished_at ?? null, running: false };
  }

  const connection = dropboxConnection.data;
  const dropboxRunning = (dropboxJob.data ?? []).length > 0;
  let dropbox: IntegrationStatus;
  if (!connection || connection.status === "disconnected") {
    dropbox = { key: "dropbox", name: "Dropbox", tone: "info", headline: "Dropbox is not connected.", detail: "Connect it to import documents automatically.", lastSuccessAt: null, running: false };
  } else if (connection.status === "needs_reconnect") {
    dropbox = { key: "dropbox", name: "Dropbox", tone: "bad", headline: "Dropbox needs reconnecting.", detail: "Access has expired or was withdrawn. Press Reconnect Dropbox.", lastSuccessAt: connection.last_success_at, running: false };
  } else if (connection.status === "error") {
    dropbox = { key: "dropbox", name: "Dropbox", tone: "bad", headline: "The last Dropbox sync failed.", detail: connection.last_error ?? "It will be tried again automatically.", lastSuccessAt: connection.last_success_at, running: dropboxRunning };
  } else if (dropboxRunning) {
    dropbox = { key: "dropbox", name: "Dropbox", tone: "info", headline: "Dropbox sync is running…", detail: connection.display_name ?? "", lastSuccessAt: connection.last_success_at, running: true };
  } else {
    dropbox = {
      key: "dropbox", name: "Dropbox", tone: "good", running: false, lastSuccessAt: connection.last_success_at,
      headline: connection.last_success_at ? "Dropbox is up to date." : "Dropbox is connected.",
      detail: connection.last_success_at ? `Last checked ${formatRelative(connection.last_success_at)}.` : "Choose folders to watch, then press Sync Dropbox.",
    };
  }

  return { dpd, dropbox, reviewCount: reviews.count ?? 0, failedFiles: failed.count ?? 0, lastImportAt: lastFile.data?.created_at ?? null };
}
