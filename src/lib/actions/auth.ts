"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FRANCHISE_COOKIE } from "@/lib/context";
import { env } from "@/lib/env";
import { requireBillingAccess } from "@/lib/billing/gate";
import { isDriverLogin } from "@/lib/driver/context";
import { londonToday } from "@/lib/dates";
import { queueFirstSync } from "@/lib/dpd/first-sync";
import { addDpdLogin } from "@/lib/dpd/logins";
import { enqueueJob } from "@/lib/jobs/queue";
import { MAX_DPD_LOGINS, readDpdLoginBlocks } from "@/lib/onboarding/dpd-logins-form";
import { parseFdNumbers } from "@/lib/onboarding/franchises";
import { createAdminClient } from "@/lib/supabase/admin";
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
  // With two-step sign-in on, the password is only the first step: ask for the code before anything else.
  const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level && level.nextLevel === "aal2" && level.currentLevel !== "aal2") redirect(`/login/verify?next=${encodeURIComponent(next)}`);
  redirect(next);
}

const signUpSchema = z
  .object({
    email: z.email("Enter your email address."),
    password: z.string().min(10, "Use at least 10 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "The two passwords do not match.", path: ["confirm"] });

/** Creates a login. The next step is always the subscribe page; an emailed confirmation link, if required, leads there too. */
export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(signUpSchema, formData);
  if ("error" in parsed) return parsed.error;
  const origin = (await headers()).get("origin");
  const base = (origin && /^https?:\/\//.test(origin) ? origin : env.appUrl()).replace(/\/$/, "");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${base}/auth/confirm?next=/subscribe` },
  });
  if (error) {
    return fail(
      error.status === 422 || error.status === 400 ? "That email or password was not accepted. Check the email address, and use at least 10 characters for the password." : "Sign-up is not available right now. Please try again in a moment.",
      `${error.status ?? ""} ${error.message}`.trim(),
    );
  }
  // With email confirmation switched on there is no session yet: the link in the email finishes the job.
  if (!data.session) return ok("Check your email. We have sent a link to confirm your address; it brings you back here to choose your plan.");
  redirect("/subscribe");
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
});

const dpdLoginSchema = z.object({
  username: z.string().min(1, "Enter your DPD portal username.").max(200),
  password: z.string().min(1, "Enter your DPD portal password.").max(500),
  label: z.string().max(120),
});

/**
 * Finishes sign-up: creates the business, saves each DPD login (encrypted), links any FD numbers typed against their login,
 * and starts the first read of DPD. A login with no FD numbers is read from DPD to find its franchises.
 * The person then lands on a progress screen while their dashboard fills in.
 */
export async function completeOnboarding(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(onboardingSchema, formData);
  if ("error" in parsed) return parsed.error;

  const blocks = readDpdLoginBlocks(formData);
  if (blocks.length === 0) return fail("Add at least one DPD login.", null, { dpdUsername_0: "Enter your DPD portal username." });
  if (blocks.length > MAX_DPD_LOGINS) return fail(`You can add up to ${MAX_DPD_LOGINS} DPD logins.`);

  // Check every login and its FD numbers before anything is created.
  const fieldErrors: Record<string, string> = {};
  const seenFds = new Map<string, string>();
  const checked: { label: string; username: string; password: string; fds: string[]; id: string }[] = [];
  for (const block of blocks) {
    const login = dpdLoginSchema.safeParse({ username: block.username, password: block.password, label: block.label });
    if (!login.success) {
      for (const issue of login.error.issues) {
        const field = issue.path[0] === "username" ? "dpdUsername" : issue.path[0] === "password" ? "dpdPassword" : "dpdLabel";
        fieldErrors[`${field}_${block.id}`] = issue.message;
      }
    }
    const fds = block.fds ? parseFdNumbers(block.fds) : { fdNumbers: [] as string[], errors: [] as string[] };
    if (fds.errors.length > 0) fieldErrors[`dpdFds_${block.id}`] = fds.errors[0]!;
    for (const fd of fds.fdNumbers) {
      if (seenFds.has(fd)) fieldErrors[`dpdFds_${block.id}`] = `${fd} is already listed on another login.`;
      else seenFds.set(fd, block.id);
    }
    if (login.success) {
      checked.push({ id: block.id, label: login.data.label || login.data.username, username: login.data.username, password: block.password, fds: fds.fdNumbers });
    }
  }
  if (Object.keys(fieldErrors).length > 0) return fail("Please check your DPD logins.", null, fieldErrors);

  const supabase = await createClient();
  await requireBillingAccess(supabase);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  if (await isDriverLogin(auth.user.id)) return fail("This login is for viewing a driver's pay, so it cannot set up a business.");

  const { data: accountId, error } = await supabase.rpc("bootstrap_account", {
    p_business_name: parsed.data.businessName,
    p_full_name: parsed.data.fullName,
  });
  if (error) return dbFailure(error, "Your business could not be set up. Please try again.");
  const account = accountId as string;

  const admin = createAdminClient();
  const loginIds: string[] = [];
  try {
    for (const login of checked) {
      loginIds.push(await addDpdLogin(admin, account, auth.user.id, login.label, { username: login.username, password: login.password }));
    }
  } catch (error) {
    return fail("Your business was set up, but a DPD login could not be saved. Open Settings, add your DPD logins there, then press Sync DPD.", error instanceof Error ? error.message : null);
  }

  const franchiseRows = checked.flatMap((login, i) => login.fds.map((fd) => ({ account_id: account, fd_number: fd, name: "", dpd_login_id: loginIds[i] })));
  if (franchiseRows.length > 0) {
    const { error: franchiseError } = await supabase.from("franchises").insert(franchiseRows);
    if (franchiseError) return dbFailure(franchiseError, "Your business was set up, but the franchises could not be added. Add them in Settings.");
  }

  try {
    if (checked.some((login) => login.fds.length === 0)) {
      // Logins with no FD numbers: read DPD to find their franchises (also queues their first figures).
      await enqueueJob(admin, { accountId: account, type: "dpd_discovery", reportDate: londonToday(), trigger: "manual", requestedBy: auth.user.id, payload: { discoverFranchises: true } });
    }
    await queueFirstSync(admin, account, auth.user.id);
  } catch (error) {
    return fail("Your business was set up, but we could not start reading DPD. Open Settings, and press Sync DPD.", error instanceof Error ? error.message : null);
  }
  redirect("/connecting");
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
