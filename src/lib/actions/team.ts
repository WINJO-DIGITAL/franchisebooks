"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { uuid } from "./schemas";

/**
 * Team members: managers (add and change data, limited to named franchises if wanted) and viewers (look only). Owner only.
 * They share the owner's subscription. The owner's own login cannot be changed or removed here.
 */

const accessSchema = z.object({ role: z.enum(["manager", "viewer"], "Choose manager or viewer."), access: z.enum(["all", "some"], "Choose which franchises they can see.") });

/** The franchise ids ticked on the form, checked to belong to this account. Null when one does not. */
async function pickFranchises(accountId: string, formData: FormData): Promise<string[] | null> {
  const ids = [...new Set(formData.getAll("franchiseIds").map(String))];
  if (ids.length === 0) return [];
  if (!ids.every((id) => uuid.safeParse(id).success)) return null;
  const { data } = await createAdminClient().from("franchises").select("id").eq("account_id", accountId).in("id", ids);
  return (data ?? []).length === ids.length ? ids : null;
}

export async function inviteTeamMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can invite team members.");
  const parsed = parseForm(accessSchema.extend({ email: z.email("Enter their email address."), fullName: z.string().min(1, "Enter their name.").max(120, "Keep the name under 120 characters.") }), formData);
  if ("error" in parsed) return parsed.error;
  const { email, fullName, role, access } = parsed.data;
  const franchiseIds = await pickFranchises(ctx.accountId, formData);
  if (franchiseIds === null) return fail("Please check the highlighted answers.", null, { franchiseIds: "Choose from your own franchises." });
  if (access === "some" && franchiseIds.length === 0) return fail("Please check the highlighted answers.", null, { franchiseIds: "Choose at least one franchise, or choose all franchises." });

  const admin = createAdminClient();
  const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${env.appUrl()}/auth/confirm?next=/reset-password`, data: { full_name: fullName } });
  if (invited.error || !invited.data.user) {
    const taken = /already|registered|exists/i.test(invited.error?.message ?? "");
    return fail(
      taken ? "That email address already has a login, so it cannot be invited here." : "The invitation could not be sent. Please try again.",
      invited.error?.message ?? null,
      taken ? { email: "Already has a login." } : undefined,
    );
  }
  const userId = invited.data.user.id;
  const profile = await admin.from("user_profiles").insert({ id: userId, account_id: ctx.accountId, full_name: fullName, role, all_franchises: access === "all" });
  if (profile.error) {
    // Do not leave an invited login with no business behind it.
    await admin.auth.admin.deleteUser(userId);
    return dbFailure(profile.error, "The invitation could not be saved. Nothing was sent.");
  }
  if (access === "some") {
    const rows = await admin.from("user_franchise_access").insert(franchiseIds.map((franchise_id) => ({ user_id: userId, franchise_id })));
    if (rows.error) {
      await admin.auth.admin.deleteUser(userId);
      return dbFailure(rows.error, "The invitation could not be saved. Nothing was sent.");
    }
  }
  revalidatePath("/settings");
  return ok(`Invitation sent to ${email}. ${fullName} sets a password from the email, then signs in as a ${role}.`);
}

/** A member of this account who is not the owner: the only people the owner can change here. */
async function memberOf(accountId: string, userId: string) {
  const { data } = await createAdminClient().from("user_profiles").select("id, role, full_name").eq("id", userId).eq("account_id", accountId).maybeSingle();
  return data && data.role !== "owner" ? data : null;
}

export async function updateTeamMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can change team members.");
  const parsed = parseForm(accessSchema.extend({ userId: uuid }), formData);
  if ("error" in parsed) return parsed.error;
  const { userId, role, access } = parsed.data;
  const member = await memberOf(ctx.accountId, userId);
  if (!member) return fail("That team member could not be found.");
  const franchiseIds = await pickFranchises(ctx.accountId, formData);
  if (franchiseIds === null) return fail("Please check the highlighted answers.", null, { franchiseIds: "Choose from your own franchises." });
  if (access === "some" && franchiseIds.length === 0) return fail("Please check the highlighted answers.", null, { franchiseIds: "Choose at least one franchise, or choose all franchises." });

  const admin = createAdminClient();
  const update = await admin.from("user_profiles").update({ role, all_franchises: access === "all", updated_at: new Date().toISOString() }).eq("id", userId).eq("account_id", ctx.accountId);
  if (update.error) return dbFailure(update.error, "The change could not be saved. Nothing was changed.");
  const cleared = await admin.from("user_franchise_access").delete().eq("user_id", userId);
  if (cleared.error) return dbFailure(cleared.error, "The change could not be saved completely. Please check their access.");
  if (access === "some") {
    const rows = await admin.from("user_franchise_access").insert(franchiseIds.map((franchise_id) => ({ user_id: userId, franchise_id })));
    if (rows.error) return dbFailure(rows.error, "Their franchises could not be saved. Please check their access.");
  }
  revalidatePath("/settings");
  return ok(`${member.full_name || "Team member"} updated.`);
}

export async function removeTeamMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can remove team members.");
  const parsed = parseForm(z.object({ userId: uuid }), formData);
  if ("error" in parsed) return parsed.error;
  if (parsed.data.userId === ctx.userId) return fail("You cannot remove your own login.");
  const member = await memberOf(ctx.accountId, parsed.data.userId);
  if (!member) return fail("That team member could not be found.");
  const admin = createAdminClient();
  // Deleting the login removes their profile and franchise access with it. If their name is on records they entered
  // (adjustments, cover), the login has to stay for those records: it is then blocked from signing in and loses all access.
  const removed = await admin.auth.admin.deleteUser(parsed.data.userId);
  if (removed.error) {
    const blocked = await admin.auth.admin.updateUserById(parsed.data.userId, { ban_duration: "876000h" });
    if (blocked.error) return dbFailure(blocked.error, "Their access could not be removed. Nothing was changed.");
    const profile = await admin.from("user_profiles").delete().eq("id", parsed.data.userId).eq("account_id", ctx.accountId);
    if (profile.error) return dbFailure(profile.error, "Their access could not be removed completely. Please try again.");
  }
  revalidatePath("/settings");
  return ok(`${member.full_name || "Team member"} can no longer sign in.`);
}
