"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { saveDpdLogin } from "@/lib/dpd/login";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, type ActionState } from "./helpers";

const dpdLoginSchema = z.object({
  username: z.string().trim().min(1, "Enter the portal username.").max(200),
  password: z.string().min(1, "Enter the portal password.").max(500),
});

/** Saves the DPD portal login the nightly sync uses for this account. Owner only. */
export async function saveDpdLoginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can change the DPD login.");
  const parsed = parseForm(dpdLoginSchema, formData);
  if ("error" in parsed) return parsed.error;
  try {
    await saveDpdLogin(createAdminClient(), ctx.accountId, ctx.userId, parsed.data);
  } catch (error) {
    return fail("The DPD login could not be saved. Try again.", error instanceof Error ? error.message : null);
  }
  revalidatePath("/settings");
  return ok("DPD login saved. It is stored encrypted and used for the next sync.");
}
