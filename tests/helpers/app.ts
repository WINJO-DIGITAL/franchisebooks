/** Helpers for integration tests that go through the real local Supabase API. */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { AdminClient } from "@/lib/supabase/admin";

export function adminClient(): AdminClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("Integration tests only run against a local Supabase stack.");
  return createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
