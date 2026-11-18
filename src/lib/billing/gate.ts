import "server-only";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Sends a signed-in person without a paid (or comped) subscription to the subscribe page.
 * Does nothing unless BILLING_ENFORCED=true, so existing users are never locked out by accident.
 */
export async function requireBillingAccess(supabase: Supabase): Promise<void> {
  if (!env.billingEnforced()) return;
  const { data } = await supabase.rpc("billing_allows_access");
  if (!data) redirect("/subscribe");
}
