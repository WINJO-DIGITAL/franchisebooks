"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { addDpdLogin, removeDpdLogin } from "@/lib/dpd/logins";
import { parseFdNumbers } from "@/lib/onboarding/franchises";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { uuid } from "./schemas";

const addSchema = z.object({
  label: z.string().trim().min(1, "Give this login a name, for example Depot A.").max(80),
  username: z.string().trim().min(1, "Enter the DPD username.").max(200),
  password: z.string().min(1, "Enter the DPD password.").max(500),
  fdNumbers: z.string().min(1, "List the FD numbers this login can see."),
});

/** Adds another DPD login and links the franchises it can see. Owner only. */
export async function addDpdLoginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can add DPD logins.");
  const parsed = parseForm(addSchema, formData);
  if ("error" in parsed) return parsed.error;
  const fds = parseFdNumbers(parsed.data.fdNumbers);
  if (fds.errors.length > 0 || fds.fdNumbers.length === 0) {
    return fail("Please check the FD numbers.", null, { fdNumbers: fds.errors[0] ?? "List at least one FD number." });
  }
  const admin = createAdminClient();
  let loginId: string;
  try {
    loginId = await addDpdLogin(admin, ctx.accountId, ctx.userId, parsed.data.label, { username: parsed.data.username, password: parsed.data.password });
  } catch (error) {
    return fail("The login could not be added.", error instanceof Error ? error.message : null, { username: "This username may already be listed." });
  }

  // Link each FD number to this login: update a franchise that exists, add one that does not.
  const { data: existing } = await admin.from("franchises").select("id, fd_number").eq("account_id", ctx.accountId);
  const byFd = new Map((existing ?? []).map((f) => [f.fd_number, f.id]));
  const toUpdate = fds.fdNumbers.filter((fd) => byFd.has(fd)).map((fd) => byFd.get(fd)!);
  const toAdd = fds.fdNumbers.filter((fd) => !byFd.has(fd));
  if (toUpdate.length > 0) {
    const { error } = await admin.from("franchises").update({ dpd_login_id: loginId }).in("id", toUpdate);
    if (error) return dbFailure(error, "The login was added, but its franchises could not be linked. Try again.");
  }
  if (toAdd.length > 0) {
    const { error } = await admin.from("franchises").insert(toAdd.map((fd) => ({ account_id: ctx.accountId, fd_number: fd, name: "", dpd_login_id: loginId })));
    if (error) return dbFailure(error, "The login was added, but its franchises could not be added. Try again.");
  }
  revalidatePath("/settings");
  revalidatePath("/data");
  return ok(`Login added. It reads ${fds.fdNumbers.length} franchise${fds.fdNumbers.length === 1 ? "" : "s"} each night.`);
}

/** Removes a listed login. Its franchises fall back to the account's other login, if it has one. Owner only. */
export async function removeDpdLoginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can remove DPD logins.");
  const parsed = parseForm(z.object({ id: uuid }), formData);
  if ("error" in parsed) return parsed.error;
  try {
    await removeDpdLogin(createAdminClient(), ctx.accountId, parsed.data.id);
  } catch (error) {
    return fail("The login could not be removed.", error instanceof Error ? error.message : null);
  }
  revalidatePath("/settings");
  return ok("Login removed.");
}
