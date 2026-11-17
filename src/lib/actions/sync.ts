"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { formatMonth, isYearMonth, monthOf } from "@/lib/dates";
import { periodContaining, periodLabel } from "@/lib/finance/periods";
import { DropboxError } from "@/lib/dropbox/client";
import { openDropbox } from "@/lib/dropbox/connection";
import { runDropboxSync } from "@/lib/dropbox/sync";
import { portalMapSchema } from "@/lib/dpd/portal-map";
import { enqueueJob } from "@/lib/jobs/queue";
import { pokeWorker } from "@/lib/jobs/run";
import { generateMonthlyReport } from "@/lib/reports/generate";
import { createAdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";
import { dbFailure, fail, ok, parseForm, unexpectedFailure, type ActionState } from "./helpers";
import { optionalUuid, uuid } from "./schemas";

/** "Sync DPD" button: queues tonight's sync for each franchise and wakes the worker. */
export async function syncDpdNow(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to start a sync.");
  const admin = createAdminClient();
  const { data: connection } = await admin.from("integration_connections").select("config").eq("account_id", ctx.accountId).eq("provider", "dpd").maybeSingle();
  if (!(connection?.config as { portalMap?: unknown } | null)?.portalMap) {
    return fail("The DPD portal has not been set up for automatic sync yet. Until it is, upload reports by hand below or connect Dropbox.", "No portal map is stored for this account. See docs/DEPLOYMENT.md → DPD integration.");
  }
  const targets = ctx.franchise ? [ctx.franchise] : ctx.franchises.filter((f) => f.isActive);
  if (targets.length === 0) return fail("Add a franchise in Settings first.");
  try {
    let queued = 0;
    for (const franchise of targets) {
      const { alreadyQueued } = await enqueueJob(admin, { accountId: ctx.accountId, type: "dpd_sync", franchiseId: franchise.id, reportDate: ctx.today, trigger: "manual", requestedBy: ctx.userId });
      if (!alreadyQueued) queued += 1;
    }
    const poke = await pokeWorker();
    revalidatePath("/", "layout");
    if (queued === 0) return ok("A DPD sync is already running. This page will show the result when it finishes.");
    return poke.ok
      ? ok(`DPD sync started for ${targets.length} franchise${targets.length === 1 ? "" : "s"}. This usually takes a few minutes.`)
      : ok(`DPD sync queued for ${targets.length} franchise${targets.length === 1 ? "" : "s"}. It runs at the next evening sync.`);
  } catch (error) {
    return unexpectedFailure(error, "The sync could not be started.");
  }
}

/** "Sync Dropbox" button: runs a sync straight away and reports what it found. */
export async function syncDropboxNow(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to start a sync.");
  try {
    const result = await runDropboxSync(createAdminClient(), ctx.accountId, { maxFiles: 15, deadline: Date.now() + 45_000 });
    revalidatePath("/", "layout");
    return result.status === "succeeded" ? ok(result.message) : { ok: false, message: result.message, detail: null };
  } catch (error) {
    return unexpectedFailure(error, "The Dropbox sync did not finish. It will be tried again automatically.");
  }
}

export async function exploreDpdPortal(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can do this.");
  try {
    await enqueueJob(createAdminClient(), { accountId: ctx.accountId, type: "dpd_discovery", trigger: "manual", requestedBy: ctx.userId });
    const poke = await pokeWorker();
    revalidatePath("/data");
    return poke.ok
      ? ok("Exploring the DPD portal (read-only). The result will appear here in a few minutes.")
      : { ok: false, message: `The request was queued, but ${poke.reason ?? "the background worker could not be reached."} It will run when the worker is available.`, detail: null };
  } catch (error) {
    return unexpectedFailure(error);
  }
}

export async function savePortalMap(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can change the DPD portal setup.");
  const raw = String(formData.get("portalMap") ?? "").trim();
  const admin = createAdminClient();
  if (raw === "") {
    await admin.from("integration_connections").upsert({ account_id: ctx.accountId, provider: "dpd", status: "disconnected", config: {} }, { onConflict: "account_id,provider" });
    revalidatePath("/data");
    return ok("DPD portal setup removed. Automatic DPD sync is off.");
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("That is not valid JSON.", null, { portalMap: "Paste the portal setup exactly as supplied." });
  }
  const parsed = portalMapSchema.safeParse(json);
  if (!parsed.success) {
    return fail("The portal setup is not valid.", parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"), { portalMap: "Not a valid portal setup." });
  }
  const { error } = await admin.from("integration_connections").upsert(
    { account_id: ctx.accountId, provider: "dpd", status: "connected", config: { portalMap: parsed.data } as unknown as JsonObject, created_by: ctx.userId },
    { onConflict: "account_id,provider" },
  );
  if (error) return dbFailure(error);
  revalidatePath("/", "layout");
  return ok("DPD portal setup saved. Press Sync DPD to try it.");
}

export async function listDropboxFolders(path: string): Promise<{ ok: boolean; message?: string; folders: { path: string; name: string }[] }> {
  const ctx = await getContext();
  if (!ctx.isOwner) return { ok: false, message: "Only the owner can choose Dropbox folders.", folders: [] };
  if (path !== "" && !path.startsWith("/")) return { ok: false, message: "Unknown folder.", folders: [] };
  try {
    const { client } = await openDropbox(createAdminClient(), ctx.accountId);
    const folders: { path: string; name: string }[] = [];
    let page = await client.listFolder(path, false);
    for (;;) {
      for (const entry of page.entries) if (entry.tag === "folder") folders.push({ path: entry.pathDisplay, name: entry.name });
      if (!page.hasMore || folders.length > 500) break;
      page = await client.listFolderContinue(page.cursor);
    }
    return { ok: true, folders: folders.sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (error) {
    return { ok: false, message: error instanceof DropboxError ? error.message : "The folders could not be loaded from Dropbox.", folders: [] };
  }
}

export async function addDropboxFolder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can choose Dropbox folders.");
  const parsed = parseForm(z.object({ path: z.string().min(1, "Choose a folder.").max(500).refine((p) => p.startsWith("/"), "Choose a folder."), franchiseId: optionalUuid }), formData);
  if ("error" in parsed) return parsed.error;
  const { data: connection } = await ctx.supabase.from("integration_connections").select("id").eq("provider", "dropbox").maybeSingle();
  if (!connection) return fail("Connect Dropbox first.");
  const { error } = await ctx.supabase.from("integration_folders").insert({
    account_id: ctx.accountId, connection_id: connection.id, path_display: parsed.data.path, path_lower: parsed.data.path.toLowerCase(),
    default_franchise_id: parsed.data.franchiseId, created_by: ctx.userId,
  });
  if (error) return error.code === "23505" ? fail("That folder is already being watched.") : dbFailure(error);
  revalidatePath("/data");
  return ok(`Now watching “${parsed.data.path}”. Press Sync Dropbox to import what is already there.`);
}

export async function removeDropboxFolder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can choose Dropbox folders.");
  const parsed = parseForm(z.object({ id: uuid }), formData);
  if ("error" in parsed) return parsed.error;
  const { error } = await ctx.supabase.from("integration_folders").delete().eq("id", parsed.data.id);
  if (error) return dbFailure(error);
  revalidatePath("/data");
  return ok("Folder removed. Documents already imported from it are kept.");
}

export async function disconnectDropbox(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can disconnect Dropbox.");
  const admin = createAdminClient();
  try {
    const { client, connection } = await openDropbox(admin, ctx.accountId);
    await client.revoke();
    await admin.rpc("delete_integration_secret", { p_connection_id: connection.id });
  } catch {
    // Already unusable: still mark it disconnected below.
  }
  await admin.from("integration_connections").update({ status: "disconnected", last_error: null }).eq("account_id", ctx.accountId).eq("provider", "dropbox");
  revalidatePath("/", "layout");
  return ok("Dropbox disconnected. Documents already imported are kept.");
}

export async function generateReport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  // "report" is "month:2026-10" or "period:2026-10-12" (the first day of a DPD four-week period).
  const parsed = parseForm(z.object({ report: z.string().regex(/^(month:\d{4}-\d{2}|period:\d{4}-\d{2}-\d{2})$/, "Choose a month or period."), franchiseId: optionalUuid }), formData);
  if ("error" in parsed) return parsed.error;
  const [kind, value] = parsed.data.report.split(":") as ["month" | "period", string];
  const period = kind === "period" ? periodContaining(value) : null;
  if (kind === "month" && !isYearMonth(value)) return fail("Choose a month.");
  if (period && period.start !== value) return fail("Choose a period from the list.");
  const month = period ? monthOf(period.start) : value;
  if (parsed.data.franchiseId && !ctx.franchises.some((f) => f.id === parsed.data.franchiseId)) return fail("Choose one of your franchises.");
  if (!parsed.data.franchiseId && ctx.role !== "owner" && ctx.franchises.length === 0) return fail("There is nothing to report on yet.");
  try {
    const report = await generateMonthlyReport(createAdminClient(), {
      accountId: ctx.accountId, month, period, franchiseId: parsed.data.franchiseId, trigger: "manual", userId: ctx.userId,
    });
    revalidatePath("/reports");
    return ok(`Report generated for ${period ? periodLabel(period) : formatMonth(month)}.`, { id: report.id });
  } catch (error) {
    return unexpectedFailure(error, "The report could not be generated.");
  }
}
