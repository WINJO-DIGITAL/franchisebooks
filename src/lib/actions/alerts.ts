"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { ANOMALY_STATUS } from "@/lib/labels";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { optionalText, uuid } from "./schemas";

/** Records the owner's decision on an alert. This never changes any financial figure. */
export async function setAlertStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to update alerts.");
  const parsed = parseForm(
    z.object({ id: uuid, status: z.enum(["open", "investigating", "resolved", "expected", "ignored"]), note: optionalText(500) }),
    formData,
  );
  if ("error" in parsed) return parsed.error;
  const { error, data } = await ctx.supabase
    .from("anomalies")
    .update({ status: parsed.data.status, status_note: parsed.data.note, status_changed_by: ctx.userId, status_changed_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return dbFailure(error);
  if (!data?.length) return fail("That alert could not be found.");
  revalidatePath("/", "layout");
  return ok(`Marked as “${ANOMALY_STATUS[parsed.data.status]!.label}”.`);
}
