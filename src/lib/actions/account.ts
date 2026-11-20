"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { cancelAtPeriodEnd } from "@/lib/billing/stripe";
import { listDpdLogins, removeDpdLogin } from "@/lib/dpd/logins";
import { sendEmail, ownerEmail } from "@/lib/notify/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, fail, parseForm, type ActionState } from "./helpers";

/**
 * Closing the account. The owner types CLOSE to confirm. Straight away: every DPD login and its stored password is
 * deleted, so the app can no longer sign in to DPD for this account. The closure is recorded. Financial records are kept
 * for the period the terms state; the rest is handled by hand within 30 days, and the owner is told so by email.
 */
export async function requestAccountClosure(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can close the account.");
  const parsed = parseForm(z.object({ confirm: z.literal("CLOSE", { message: "Type CLOSE to confirm." }) }), formData);
  if ("error" in parsed) return parsed.error;

  const admin = createAdminClient();
  try {
    // 1. Remove every DPD login (this also deletes its stored password, through the database's cascade).
    for (const login of await listDpdLogins(admin, ctx.accountId)) {
      await removeDpdLogin(admin, ctx.accountId, login.id);
    }
    // 2. Remove the original login too.
    const { data: connection } = await admin.from("integration_connections").select("id").eq("account_id", ctx.accountId).eq("provider", "dpd").maybeSingle();
    if (connection) {
      const { error } = await admin.rpc("delete_integration_secret", { p_connection_id: connection.id });
      if (error) throw new Error(error.message);
      await admin.from("integration_connections").update({ status: "disconnected", config: {} }).eq("id", connection.id);
    }
    // 3. Record the request.
    const { error } = await (await createClient()).from("account_closure_requests").insert({ account_id: ctx.accountId, requested_by: ctx.userId });
    if (error) return dbFailure(error);
  } catch (error) {
    return fail("We could not close the account. Nothing more has been removed; please try again.", error instanceof Error ? error.message : null);
  }

  // 4. Stop the monthly payment: the subscription runs to the end of the period already paid for, then ends.
  const { data: billing } = await admin.from("user_billing").select("stripe_subscription_id, status").eq("user_id", ctx.userId).maybeSingle();
  const paying = Boolean(billing?.stripe_subscription_id && billing.status !== "canceled" && billing.status !== "comped");
  const cancelled = paying ? await cancelAtPeriodEnd(billing!.stripe_subscription_id!) : false;

  const to = await ownerEmail(admin, ctx.accountId).catch(() => null);
  if (to) {
    const payment = !paying
      ? ""
      : cancelled
        ? " Your subscription has been cancelled: it will not renew, and you will not be charged again."
        : " To stop your monthly payment, cancel under Settings, then Manage billing.";
    await sendEmail({
      to,
      subject: "Your Franchise Books closure request",
      text: `We have removed your DPD logins and their stored passwords, so the app can no longer read DPD for your account. Your financial records are kept for the period our terms set out. We will finish closing the account within 30 days.${payment}`,
    });
  }
  revalidatePath("/settings");
  redirect("/settings?closed=1");
}
