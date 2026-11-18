import "server-only";
import type { JsonObject } from "@/lib/supabase/json";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * Changes some keys of an account's DPD connection config without losing the others.
 * A value of `undefined` removes that key. Creates the connection row if the account has none yet.
 * Returns the connection id.
 */
export async function mergeDpdConfig(db: AdminClient, accountId: string, userId: string | null, patch: Record<string, unknown>, status?: "connected" | "disconnected"): Promise<string> {
  const { data: existing } = await db.from("integration_connections").select("id, config").eq("account_id", accountId).eq("provider", "dpd").maybeSingle();
  const merged: Record<string, unknown> = { ...((existing?.config as Record<string, unknown> | null) ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  if (existing) {
    const { error } = await db.from("integration_connections").update({ config: merged as JsonObject, ...(status ? { status } : {}) }).eq("id", existing.id);
    if (error) throw new Error(`Could not update the DPD connection: ${error.message}`);
    return existing.id;
  }
  const { data: created, error } = await db
    .from("integration_connections")
    .insert({ account_id: accountId, provider: "dpd", status: status ?? "disconnected", config: merged as JsonObject, created_by: userId })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create the DPD connection: ${error.message}`);
  return created.id;
}
