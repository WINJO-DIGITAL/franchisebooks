"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { londonToday } from "@/lib/dates";
import { addDpdLogin, removeDpdLogin } from "@/lib/dpd/logins";
import { enqueueJob } from "@/lib/jobs/queue";
import { startWorkerRun } from "@/lib/github/dispatch";
import { parseFdNumbers } from "@/lib/onboarding/franchises";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { uuid } from "./schemas";

const addSchema = z.object({
  label: z.string().trim().max(80).optional(),
  username: z.string().trim().min(1, "Enter the DPD username.").max(200),
  password: z.string().min(1, "Enter the DPD password.").max(500),
  fdNumbers: z.string().optional(),
});

/** Adds another DPD login and links the franchises it can see. Owner only. */
export async function addDpdLoginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can add DPD logins.");
  const parsed = parseForm(addSchema, formData);
  if ("error" in parsed) return parsed.error;
  // FD numbers are optional: left blank, they are read from the DPD portal for this login.
  const typedFds = (parsed.data.fdNumbers ?? "").trim();
  const fds = typedFds === "" ? { fdNumbers: [] as string[], errors: [] as string[] } : parseFdNumbers(typedFds);
  if (fds.errors.length > 0) {
    return fail("Please check the FD numbers.", null, { fdNumbers: fds.errors[0]! });
  }
  // The name is optional too: the username identifies the login when no name is given.
  const label = parsed.data.label?.trim() || parsed.data.username;
  const admin = createAdminClient();
  let loginId: string;
  try {
    loginId = await addDpdLogin(admin, ctx.accountId, ctx.userId, label, { username: parsed.data.username, password: parsed.data.password });
  } catch (error) {
    return fail("The login could not be added.", error instanceof Error ? error.message : null, { username: "This username may already be listed." });
  }

  if (fds.fdNumbers.length === 0) {
    // No FD numbers given: find them from the portal. One discovery job handles every login still waiting.
    try {
      await enqueueJob(admin, { accountId: ctx.accountId, type: "dpd_discovery", reportDate: londonToday(), trigger: "manual", requestedBy: ctx.userId, payload: { discoverFranchises: true } });
      await startWorkerRun();
    } catch (error) {
      return fail("The login was added, but we could not start looking up its franchises. Press Sync DPD in a few minutes, or add the FD numbers by hand.", error instanceof Error ? error.message : null);
    }
    revalidatePath("/settings");
    revalidatePath("/data");
    return ok("Login added. We are finding its franchises from DPD now; they appear here in a few minutes and their figures follow.");
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

/** "Check and refresh" for one login: signs in to check it, picks up its franchises, and re-reads them. Owner only. */
export async function refreshDpdLoginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can refresh a DPD login.");
  const parsed = parseForm(z.object({ id: uuid }), formData);
  if ("error" in parsed) return parsed.error;
  const admin = createAdminClient();
  const { data: login } = await admin.from("dpd_logins").select("id").eq("id", parsed.data.id).eq("account_id", ctx.accountId).maybeSingle();
  if (!login) return fail("That login could not be found.");
  try {
    await enqueueJob(admin, { accountId: ctx.accountId, type: "dpd_discovery", reportDate: londonToday(), trigger: "manual", requestedBy: ctx.userId, payload: { discoverFranchises: true, refreshLoginId: login.id } });
    await startWorkerRun();
  } catch (error) {
    return fail("The refresh could not be started. Please try again.", error instanceof Error ? error.message : null);
  }
  revalidatePath("/settings");
  return ok("Checking this login now. The result appears in the list in a minute or two: either its franchises and figures are updated, or the reason it could not sign in is shown.");
}

/**
 * "Start my first read" on the dashboard: the same check and refresh as Settings, for every saved login, so nobody has to
 * find the Settings page. Owner only.
 */
export async function startFirstReadAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can start the first read.");
  const admin = createAdminClient();
  const { data: logins } = await admin.from("dpd_logins").select("id").eq("account_id", ctx.accountId);
  if (!logins?.length) return fail("Add a DPD login first, then the first read can start.");
  try {
    for (const login of logins) {
      await enqueueJob(admin, { accountId: ctx.accountId, type: "dpd_discovery", reportDate: londonToday(), trigger: "manual", requestedBy: ctx.userId, payload: { discoverFranchises: true, refreshLoginId: login.id } });
    }
    const started = await startWorkerRun();
    if (!started.started) return fail("The first read is queued, but GitHub did not start it. It will run in tonight's sync.", started.message);
  } catch (error) {
    return fail("The first read could not be started. Please try again.", error instanceof Error ? error.message : null);
  }
  revalidatePath("/");
  return ok("Reading your DPD account now. Your figures appear here in a few minutes.");
}
