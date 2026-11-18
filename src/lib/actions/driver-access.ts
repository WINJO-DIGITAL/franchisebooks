"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";
import { uuid } from "./schemas";

/**
 * Invites a driver to see their own pay. Owner only. The driver gets an email to set a password. Their login is linked to their
 * driver record and has no business profile, so it can read nothing except their own page.
 */
export async function inviteDriverLogin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can invite a driver.");
  const parsed = parseForm(z.object({ driverId: uuid, email: z.email("Enter the driver's email address.") }), formData);
  if ("error" in parsed) return parsed.error;
  const { driverId, email } = parsed.data;

  // The driver must belong to this account (the owner's own access rules enforce that).
  const { data: driver } = await ctx.supabase.from("drivers").select("id, display_name").eq("id", driverId).maybeSingle();
  if (!driver) return fail("That driver could not be found.");
  const { data: existing } = await ctx.supabase.from("driver_accounts").select("user_id").eq("driver_id", driverId).maybeSingle();
  if (existing) return fail(`${driver.display_name} already has a login. Remove it first to invite a different email address.`);

  const admin = createAdminClient();
  const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${env.appUrl()}/auth/confirm?next=/reset-password` });
  if (invited.error || !invited.data.user) {
    const taken = /already|registered|exists/i.test(invited.error?.message ?? "");
    return fail(
      taken ? "That email address already has a login. Use a different address for the driver." : "The invitation could not be sent. Please try again.",
      invited.error?.message ?? null,
      taken ? { email: "Already has a login." } : undefined,
    );
  }

  const { error } = await admin.from("driver_accounts").insert({ user_id: invited.data.user.id, account_id: ctx.accountId, driver_id: driverId, email, created_by: ctx.userId });
  if (error) {
    // Do not leave an invited login with nothing linked to it.
    await admin.auth.admin.deleteUser(invited.data.user.id);
    return dbFailure(error, "The invitation could not be saved. Nothing was sent.");
  }
  revalidatePath(`/drivers/${driverId}`);
  return ok(`Invitation sent to ${email}. ${driver.display_name} sets a password from the email, then sees their own pay.`);
}

/** Removes a driver's access. The login is deleted, unless it somehow also belongs to a business user (it never should). */
export async function removeDriverLogin(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can remove a driver's access.");
  const parsed = parseForm(z.object({ driverId: uuid }), formData);
  if ("error" in parsed) return parsed.error;
  const { data: link } = await ctx.supabase.from("driver_accounts").select("user_id").eq("driver_id", parsed.data.driverId).maybeSingle();
  if (!link) return fail("This driver has no login to remove.");

  const admin = createAdminClient();
  const { error } = await admin.from("driver_accounts").delete().eq("driver_id", parsed.data.driverId).eq("account_id", ctx.accountId);
  if (error) return dbFailure(error);
  // Delete the login itself only if it is purely a driver login (no business profile).
  const { data: profile } = await admin.from("user_profiles").select("id").eq("id", link.user_id).maybeSingle();
  if (!profile) await admin.auth.admin.deleteUser(link.user_id);
  revalidatePath(`/drivers/${parsed.data.driverId}`);
  return ok("Access removed. They can no longer sign in to see their pay.");
}
