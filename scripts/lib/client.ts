import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import { requireEnv } from "./env";

export type ScriptClient = SupabaseClient<Database>;

/** Service-role client for trusted command-line use. Never log or print its key. */
export function serviceClient(): { client: ScriptClient; url: string } {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL", "The database address is not set.");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY", "The server database key is not set.");
  return { client: createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } }), url };
}

export function anonClient(): ScriptClient {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL", "The database address is not set.");
  const key = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "The public database key is not set.");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
