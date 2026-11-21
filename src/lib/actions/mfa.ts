"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, parseForm, type ActionState } from "./helpers";
import { uuid } from "./schemas";

/**
 * Two-step sign-in with an authenticator app (a six-digit code that changes every 30 seconds). Anyone can turn it on for their
 * own login. Once a code has been confirmed, signing in needs the password and a code. Supabase holds the secret; this app never
 * sees it again after showing it once while setting up.
 */

const codeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");

/** A message for Supabase's own refusals, in plain English. */
function plain(error: { message: string; status?: number }): ActionState {
  if (/disabled|not enabled/i.test(error.message)) return fail("Two-step sign-in is not switched on for this service yet.", error.message);
  if (/aal2|assurance/i.test(error.message)) return fail("Sign in again with your code first, then try this again.", error.message);
  return fail("That did not work. Please try again.", `${error.status ?? ""} ${error.message}`.trim());
}

/** Starts setting up. Returns the QR code and the secret to type in by hand, to show once. */
export async function startMfaEnrollment(): Promise<ActionState> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return fail("Please sign in again.");
  // A set-up that was started and never finished would block a new one, so clear those first.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`, issuer: "Franchise Books" });
  if (error || !data) return plain(error ?? { message: "no data" });
  return ok("Scan the code with your authenticator app, then enter the 6-digit code it shows.", { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
}

/** Finishes setting up by proving the app shows the right code. */
export async function confirmMfaEnrollment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ factorId: uuid, code: codeSchema }), formData);
  if ("error" in parsed) return parsed.error;
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: parsed.data.factorId, code: parsed.data.code });
  if (error) return fail("That code was not right. Check the code on your phone and try again.", error.message, { code: "Not the right code." });
  revalidatePath("/settings");
  return ok("Two-step sign-in is on. From now on, signing in needs a code from your authenticator app.");
}

/** Turns it off. Needs a session that has used a code, so it cannot be done with only the password. */
export async function turnOffMfa(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ factorId: uuid }), formData);
  if ("error" in parsed) return parsed.error;
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: parsed.data.factorId });
  if (error) return plain(error);
  revalidatePath("/settings");
  return ok("Two-step sign-in is off.");
}

/** The second step of signing in: the code from the app, then on to where they were going. */
export async function verifyMfaCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ code: codeSchema, next: z.string().optional() }), formData);
  if ("error" in parsed) return parsed.error;
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/login");
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp.find((f) => f.status === "verified");
  if (!factor) redirect("/");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data.code });
  if (error) return fail("That code was not right. Check the code on your phone and try again.", error.message, { code: "Not the right code." });
  const next = parsed.data.next && parsed.data.next.startsWith("/") && !parsed.data.next.startsWith("//") ? parsed.data.next : "/";
  redirect(next);
}
