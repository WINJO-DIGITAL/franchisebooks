/**
 * Creates the owner's sign-in and business.
 *
 *   npm run create-owner -- --email owner@example.com --name "Owner Name" --business "My Couriers" [--fd FD-123]
 *
 * The password is read from the OWNER_PASSWORD environment variable (never from
 * the command line, where it would end up in shell history). Public sign-up is
 * switched off, so this is how the first account is made. Works against local
 * or production Supabase, using the service role key from the environment.
 */
import { createClient } from "@supabase/supabase-js";
import { arg, loadLocalEnv } from "./lib/env";

loadLocalEnv();

async function main() {
  const email = arg("email");
  const name = arg("name") ?? "Owner";
  const business = arg("business");
  const fd = arg("fd");
  const password = process.env.OWNER_PASSWORD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!email || !business || !password || !url || !anon || !service) {
    console.error("Usage: OWNER_PASSWORD=… npm run create-owner -- --email <email> --business <name> [--name <your name>] [--fd <FD number>]\nAlso needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(1);
  }
  if (password.length < 10) {
    console.error("OWNER_PASSWORD must be at least 10 characters.");
    process.exit(1);
  }

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error && !/already/i.test(created.error.message)) throw new Error(created.error.message);

  // Sign in as the new user so the account is created through the same RPC (and rules) the app uses.
  const user = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const session = await user.auth.signInWithPassword({ email, password });
  if (session.error) throw new Error(`Could not sign in as the new user: ${session.error.message}`);
  const { data: existing } = await user.from("user_profiles").select("account_id").maybeSingle();
  if (existing) {
    console.log("This user already has a business. Nothing changed.");
    return;
  }
  const { data: accountId, error } = await user.rpc("bootstrap_account", { p_business_name: business, p_full_name: name });
  if (error) throw new Error(error.message);
  if (fd) {
    const { error: franchiseError } = await user.from("franchises").insert({ account_id: accountId as string, fd_number: fd.toUpperCase() });
    if (franchiseError) throw new Error(franchiseError.message);
  }
  console.log(`Created ${business} for ${email}${fd ? ` with franchise ${fd.toUpperCase()}` : ""}. Sign in at the app's login page.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
