"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { decideReviewItem, importDocument } from "@/lib/ingest/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbFailure, fail, ok, parseForm, unexpectedFailure, type ActionState } from "./helpers";
import { optionalText, optionalUuid, uuid } from "./schemas";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;

/**
 * Manual upload. Uses exactly the same import pipeline — and therefore the
 * same validation and duplicate prevention — as the automated sources.
 */
export async function uploadDocuments(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to upload documents.");
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail("Choose at least one file to upload.");
  if (files.length > MAX_FILES) return fail(`Upload up to ${MAX_FILES} files at a time.`);
  const hintRaw = String(formData.get("franchiseId") ?? "");
  const franchiseHintId = ctx.franchises.some((f) => f.id === hintRaw) ? hintRaw : null;

  const admin = createAdminClient();
  const lines: string[] = [];
  let problems = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      lines.push(`“${file.name}” is larger than 20 MB and was not uploaded.`);
      problems++;
      continue;
    }
    try {
      const outcome = await importDocument(admin, {
        accountId: ctx.accountId, source: "manual_upload", filename: file.name, mimeType: file.type || null,
        bytes: new Uint8Array(await file.arrayBuffer()), franchiseHintId, uploadedBy: ctx.userId,
        // A login limited to some franchises may only import into those.
        allowedFranchiseIds: ctx.allFranchises ? null : ctx.franchises.map((f) => f.id),
      });
      lines.push(outcome.message);
      if (outcome.status === "needs_review" || outcome.status === "failed") problems++;
    } catch (error) {
      const failure = unexpectedFailure(error, `“${file.name}” could not be uploaded.`);
      lines.push(failure.message);
      problems++;
    }
  }
  revalidatePath("/", "layout");
  const message = lines.join(" ");
  return problems > 0 ? { ok: false, message, detail: null } : ok(message);
}

export async function decideReview(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to do that.");
  const parsed = parseForm(z.object({ id: uuid, decision: z.enum(["accept", "reject"]), franchiseId: optionalUuid, note: optionalText(300) }), formData);
  if ("error" in parsed) return parsed.error;
  // Check through the user's own session that they are allowed to see this item before acting with elevated rights.
  const { data: visible } = await ctx.supabase.from("review_items").select("id").eq("id", parsed.data.id).maybeSingle();
  if (!visible) return fail("That item could not be found.");
  if (parsed.data.franchiseId && !ctx.franchises.some((f) => f.id === parsed.data.franchiseId)) return fail("Choose one of your franchises.");
  try {
    const result = await decideReviewItem(createAdminClient(), {
      accountId: ctx.accountId, reviewItemId: parsed.data.id, userId: ctx.userId, decision: parsed.data.decision,
      franchiseId: parsed.data.franchiseId, note: parsed.data.note,
    });
    revalidatePath("/", "layout");
    return ok(result.message);
  } catch (error) {
    return error instanceof Error && !/failed:/.test(error.message) ? fail(error.message) : unexpectedFailure(error);
  }
}

export async function resolveConflict(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to do that.");
  const parsed = parseForm(z.object({ id: uuid, choice: z.enum(["keep_existing", "use_incoming"]), note: optionalText(300) }), formData);
  if ("error" in parsed) return parsed.error;
  const { data: item } = await ctx.supabase.from("review_items").select("id, imported_file_id").eq("id", parsed.data.id).maybeSingle();
  if (!item) return fail("That item could not be found.");
  const { error } = await ctx.supabase.rpc("resolve_earnings_conflict", { p_review_item_id: parsed.data.id, p_choice: parsed.data.choice, p_note: parsed.data.note as string });
  if (error) return dbFailure(error);

  // Once every question about a document is answered, the document is no longer "needs checking".
  if (item.imported_file_id) {
    const admin = createAdminClient();
    const { count } = await admin.from("review_items").select("id", { count: "exact", head: true }).eq("imported_file_id", item.imported_file_id).eq("status", "open");
    if ((count ?? 0) === 0) await admin.from("imported_files").update({ status: "imported" }).eq("id", item.imported_file_id).eq("account_id", ctx.accountId).eq("status", "needs_review");
    await admin.from("anomalies").update({ status: "resolved", auto_resolved: true, status_changed_at: new Date().toISOString(), status_note: "The conflict was resolved." })
      .eq("account_id", ctx.accountId).eq("anomaly_type", "source_conflict").contains("metric", { reviewItemId: parsed.data.id }).in("status", ["open", "investigating"]);
  }
  revalidatePath("/", "layout");
  return ok(parsed.data.choice === "use_incoming" ? "The newer figures are now used. The earlier figures are kept on record." : "Kept the existing figures. Nothing was changed.");
}
