/**
 * Dropbox folder synchronisation.
 *
 * Each watched folder keeps a Dropbox cursor, so every run only looks at what
 * changed since the last one. New files go through the shared import
 * pipeline. The cursor is advanced only after a page of changes has been
 * fully handled, so an interrupted run simply repeats that page — and because
 * imports are idempotent, repeating is harmless.
 */

import "server-only";
import { importDocument } from "@/lib/ingest/pipeline";
import { describeError } from "@/lib/logger";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";
import { DropboxError, type DropboxEntry } from "./client";
import { markNeedsReconnect, openDropbox } from "./connection";

const SUPPORTED = /\.(pdf|csv|xlsx|xlsm|tsv)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

export interface DropboxSyncResult {
  status: "succeeded" | "partial" | "blocked";
  message: string;
  detected: number;
  imported: number;
  duplicates: number;
  needsAttention: number;
  failed: number;
  skipped: number;
  moreToDo: boolean;
}

export async function runDropboxSync(
  db: AdminClient,
  accountId: string,
  options: { importJobId?: string | null; maxFiles?: number; deadline?: number; fetchImpl?: typeof fetch } = {},
): Promise<DropboxSyncResult> {
  const maxFiles = options.maxFiles ?? 25;
  const result: DropboxSyncResult = { status: "succeeded", message: "", detected: 0, imported: 0, duplicates: 0, needsAttention: 0, failed: 0, skipped: 0, moreToDo: false };
  const log = (level: "info" | "warning" | "error", event: string, message: string, detail: Record<string, unknown> = {}) =>
    db.from("sync_logs").insert({ account_id: accountId, integration: "dropbox", import_job_id: options.importJobId ?? null, level, event, message, detail: detail as JsonObject });

  let opened;
  try {
    opened = await openDropbox(db, accountId, options.fetchImpl);
  } catch (error) {
    if (error instanceof DropboxError && (error.kind === "needs_reconnect" || error.kind === "not_configured")) {
      const message = error.kind === "not_configured" ? error.message : "Dropbox needs reconnecting.";
      await log("warning", "sync_blocked", message);
      return { ...result, status: "blocked", message };
    }
    throw error;
  }
  const { client, connection } = opened;

  const { data: folders } = await db.from("integration_folders").select("id, path_display, path_lower, default_franchise_id, cursor").eq("connection_id", connection.id).order("path_lower");
  if (!folders || folders.length === 0) {
    const message = "Dropbox is connected, but no folders have been chosen yet.";
    await log("info", "sync_skipped", message);
    return { ...result, status: "blocked", message };
  }

  let processed = 0;
  try {
    for (const folder of folders) {
      let cursor = folder.cursor;
      let done = false;
      while (!done) {
        let page;
        try {
          page = cursor ? await client.listFolderContinue(cursor) : await client.listFolder(folder.path_lower, true);
        } catch (error) {
          if (error instanceof DropboxError && error.kind === "cursor_reset") {
            cursor = null;
            await db.from("integration_folders").update({ cursor: null }).eq("id", folder.id);
            continue;
          }
          if (error instanceof DropboxError && error.kind === "not_found") {
            result.failed += 1;
            await log("warning", "folder_missing", `The Dropbox folder “${folder.path_display}” no longer exists. Remove it or choose another folder.`);
            break;
          }
          throw error;
        }

        let pageComplete = true;
        for (const entry of page.entries) {
          if (entry.tag !== "file") continue;
          if (processed >= maxFiles || (options.deadline && Date.now() > options.deadline)) {
            pageComplete = false;
            result.moreToDo = true;
            break;
          }
          const handled = await handleFile(db, accountId, client, entry, folder.default_franchise_id, options.importJobId ?? null, result, log);
          if (handled) processed += 1;
        }
        if (!pageComplete) {
          done = true;
          break; // cursor not advanced: this page is repeated next time, already-imported files are skipped
        }
        cursor = page.cursor;
        await db.from("integration_folders").update({ cursor, last_checked_at: new Date().toISOString() }).eq("id", folder.id);
        done = !page.hasMore;
      }
      if (result.moreToDo) break;
    }
  } catch (error) {
    if (error instanceof DropboxError && error.kind === "needs_reconnect") {
      await markNeedsReconnect(db, accountId, error.message);
      const message = "Dropbox needs reconnecting.";
      await log("error", "needs_reconnect", message);
      return { ...result, status: "blocked", message };
    }
    await db.from("integration_connections").update({ status: "error", last_error: "The last Dropbox sync did not finish. It will be tried again.", last_sync_at: new Date().toISOString() }).eq("id", connection.id);
    await log("error", "sync_failed", "The Dropbox sync did not finish. It will be tried again automatically.", { error: describeError(error) });
    throw error;
  }

  const now = new Date().toISOString();
  await db.from("integration_connections").update({ status: "connected", last_sync_at: now, last_success_at: now, last_error: null }).eq("id", connection.id);

  const parts: string[] = [];
  if (result.detected === 0) parts.push("no new files");
  else {
    parts.push(`${result.detected} new file${result.detected === 1 ? "" : "s"} found`);
    if (result.imported) parts.push(`${result.imported} imported`);
    if (result.duplicates) parts.push(`${result.duplicates} already imported`);
    if (result.needsAttention) parts.push(`${result.needsAttention} need${result.needsAttention === 1 ? "s" : ""} checking`);
    if (result.failed) parts.push(`${result.failed} failed`);
    if (result.skipped) parts.push(`${result.skipped} skipped (not a supported file type)`);
  }
  result.message = `Dropbox checked: ${parts.join(", ")}.${result.moreToDo ? " More files are waiting and will be picked up shortly." : ""}`;
  result.status = result.failed > 0 || result.needsAttention > 0 ? "partial" : "succeeded";
  await log(result.status === "succeeded" ? "info" : "warning", "sync_finished", result.message, { ...result });
  return result;
}

async function handleFile(
  db: AdminClient,
  accountId: string,
  client: Awaited<ReturnType<typeof openDropbox>>["client"],
  entry: DropboxEntry,
  franchiseHintId: string | null,
  importJobId: string | null,
  result: DropboxSyncResult,
  log: (level: "info" | "warning" | "error", event: string, message: string, detail?: Record<string, unknown>) => unknown,
): Promise<boolean> {
  // This exact version of this file has been handled before: skip without downloading.
  const sourceRef = `dropbox:${entry.id ?? entry.pathLower}:${entry.contentHash ?? entry.serverModified ?? ""}`;
  const { data: known } = await db.from("imported_files").select("id").eq("account_id", accountId).eq("source", "dropbox").eq("source_ref", sourceRef).limit(1);
  if (known && known.length > 0) return false;

  result.detected += 1;
  if (!SUPPORTED.test(entry.name)) {
    result.skipped += 1;
    return false;
  }
  if ((entry.size ?? 0) > MAX_BYTES) {
    result.failed += 1;
    await log("warning", "file_too_large", `“${entry.name}” in Dropbox is larger than 20 MB and was not imported.`, { path: entry.pathDisplay });
    return true;
  }
  try {
    const bytes = await client.download(entry.id ?? entry.pathLower);
    const outcome = await importDocument(db, {
      accountId, source: "dropbox", sourceRef, filename: entry.name, bytes, franchiseHintId, importJobId,
    });
    if (outcome.status === "imported") result.imported += 1;
    else if (outcome.status === "duplicate") result.duplicates += 1;
    else if (outcome.status === "needs_review") result.needsAttention += 1;
    else result.failed += 1;
  } catch (error) {
    if (error instanceof DropboxError && error.kind === "needs_reconnect") throw error;
    result.failed += 1;
    await log("error", "file_failed", `“${entry.name}” could not be imported from Dropbox.`, { path: entry.pathDisplay, error: describeError(error) });
  }
  return true;
}
