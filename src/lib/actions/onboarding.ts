"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { queueFirstSync } from "@/lib/dpd/first-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionState } from "./helpers";

/** "Try again" on the connecting screen: queues the DPD read again for every franchise that is not already being read. */
export async function retryFirstSync(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can do this.");
  try {
    await queueFirstSync(createAdminClient(), ctx.accountId, ctx.userId);
  } catch (error) {
    return fail("We could not start the read. Please try again.", error instanceof Error ? error.message : null);
  }
  revalidatePath("/connecting");
  return ok("Trying again.");
}
