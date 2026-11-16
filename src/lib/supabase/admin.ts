import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "./database.types";

export type AdminClient = SupabaseClient<Database>;

let cached: AdminClient | null = null;

/**
 * Service-role client. Bypasses Row Level Security, so it must only be used
 * on the server by trusted code paths (import pipeline, scheduled jobs, the
 * worker) and never with unchecked user input deciding the account.
 */
export function createAdminClient(): AdminClient {
  if (!cached) {
    cached = createClient<Database>(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
