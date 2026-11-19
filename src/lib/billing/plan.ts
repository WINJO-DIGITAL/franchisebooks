import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { logger } from "@/lib/logger";
import type { AdminClient } from "@/lib/supabase/admin";
import { statusGrantsAccess, type Plan } from "./status";

/**
 * The plan of the signed-in person's account (their own subscription, or their business owner's), or null when they have no
 * access. Until the plans migration is applied the database has no plan to give, so everyone is treated as Standard: Max
 * features stay hidden rather than the page failing.
 */
export async function currentPlan(supabase: SupabaseClient<Database>): Promise<Plan | null> {
  const { data, error } = await supabase.rpc("billing_plan");
  if (error) {
    logger.warn({ error: error.message }, "billing_plan is not available; treating the account as Standard");
    const { data: allowed } = await supabase.rpc("billing_allows_access");
    return allowed ? "standard" : null;
  }
  return data === "max" ? "max" : data === "standard" ? "standard" : null;
}

/** The plan of an account, for the background worker (no signed-in user): its owner's subscription. Standard when unknown. */
export async function accountPlan(db: AdminClient, accountId: string): Promise<Plan> {
  const { data: owner } = await db.from("user_profiles").select("id").eq("account_id", accountId).eq("role", "owner").limit(1).maybeSingle();
  if (!owner) return "standard";
  const { data, error } = await db.from("user_billing").select("plan, status").eq("user_id", owner.id).maybeSingle();
  if (error || !data) return "standard";
  return data.plan === "max" && statusGrantsAccess(data.status) ? "max" : "standard";
}
