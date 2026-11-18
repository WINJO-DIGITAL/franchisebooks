"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FRANCHISE_COOKIE } from "@/lib/context";
import { env } from "@/lib/env";
import { requireBillingAccess } from "@/lib/billing/gate";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, fail, ok, parseForm, type ActionState } from "./helpers";

const signInSchema = z.object({
  email: z.email("Enter your email address."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(signInSchema, formData);
  if ("error" in parsed) return parsed.error;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    return fail(
      error.status === 400 ? "That email and password do not match. Please try again." : "Sign-in is not available right now. Please try again in a moment.",
      `${error.status ?? ""} ${error.message}`.trim(),
    );
  }
  const next = parsed.data.next && parsed.data.next.startsWith("/") && !parsed.data.next.startsWith("//") ? parsed.data.next : "/";
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" }); // this device only
  redirect("/login");
}

export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(z.object({ email: z.email("Enter your email address.") }), formData);
  if ("error" in parsed) return parsed.error;
  // Send the link back to the address the person is using right now. The sign-in
  // "code verifier" cookie belongs to this host, so a link that lands on a different
  // host (www. versus bare domain, localhost versus 127.0.0.1) could not be completed.
  // Supabase still only redirects to addresses on its own allow-list.
  const origin = (await headers()).get("origin");
  const base = origin && /^https?:\/\//.test(origin) ? origin : env.appUrl();
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${base.replace(/\/$/, "")}/auth/reset` });
  // Same answer whether or not the address exists, so the form cannot be used to probe for accounts.
  return ok("If that address has an account, a reset link is on its way. Check your inbox.");
}

export async function updatePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(
    z.object({ password: z.string().min(10, "Use at least 10 characters."), confirm: z.string() }).refine((v) => v.password === v.confirm, {
      message: "The two passwords do not match.", path: ["confirm"],
    }),
    formData,
  );
  if ("error" in parsed) return parsed.error;
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail("The password could not be changed. Open the reset link from your email again.", error.message);
  redirect("/");
}

const onboardingSchema = z.object({
  businessName: z.string().min(2, "Enter your business name.").max(120),
  fullName: z.string().min(2, "Enter your name.").max(120),
  fdNumber: z.string().max(40).optional(),
  franchiseName: z.string().max(120).optional(),
});

export async function completeOnboarding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(onboardingSchema, formData);
  if ("error" in parsed) return parsed.error;
  const supabase = await createClient();
  await requireBillingAccess(supabase);
  const { data: accountId, error } = await supabase.rpc("bootstrap_account", {
    p_business_name: parsed.data.businessName,
    p_full_name: parsed.data.fullName,
  });
  if (error) return dbFailure(error, "Your business could not be set up. Please try again.");
  if (parsed.data.fdNumber) {
    const { error: franchiseError } = await supabase.from("franchises").insert({
      account_id: accountId as string,
      fd_number: parsed.data.fdNumber.toUpperCase(),
      name: parsed.data.franchiseName ?? "",
    });
    if (franchiseError) return dbFailure(franchiseError, "Your business was set up, but the franchise could not be added. You can add it in Settings.");
  }
  redirect("/");
}

export async function selectFranchise(formData: FormData): Promise<void> {
  const value = String(formData.get("franchise") ?? "all");
  const store = await cookies();
  if (value === "all") store.delete(FRANCHISE_COOKIE);
  else if (/^[0-9a-f-]{36}$/.test(value)) {
    store.set(FRANCHISE_COOKIE, value, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365 });
  }
  revalidatePath("/", "layout");
}
