import "server-only";
import { decryptJson, encryptJson } from "@/lib/crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import { mergeDpdConfig } from "./config";

/** The DPD portal login for one account. Stored encrypted; never sent back to the browser. */
export interface DpdLogin {
  username: string;
  password: string;
}

/** Saves (or replaces) an account's DPD portal login. It is encrypted before it is stored. */
export async function saveDpdLogin(db: AdminClient, accountId: string, userId: string | null, login: DpdLogin): Promise<void> {
  // Make sure the connection exists first (without marking the account ready), store the secret, then mark it ready.
  const connectionId = await mergeDpdConfig(db, accountId, userId, {});
  const { error } = await db.rpc("save_integration_secret", { p_connection_id: connectionId, p_ciphertext: encryptJson(login) });
  if (error) throw new Error(`Could not store the DPD login: ${error.message}`);
  await mergeDpdConfig(db, accountId, userId, { loginSavedAt: new Date().toISOString() }, "connected");
}

/** Reads and decrypts an account's DPD portal login, or returns null if none is saved (or it cannot be read). */
export async function loadDpdLogin(db: AdminClient, accountId: string): Promise<DpdLogin | null> {
  const { data: row } = await db.from("integration_connections").select("id").eq("account_id", accountId).eq("provider", "dpd").maybeSingle();
  if (!row) return null;
  const { data: ciphertext, error } = await db.rpc("read_integration_secret", { p_connection_id: row.id });
  if (error || !ciphertext) return null;
  try {
    const login = decryptJson<DpdLogin>(ciphertext as string);
    return login.username && login.password ? login : null;
  } catch {
    return null;
  }
}

export async function hasDpdLogin(db: AdminClient, accountId: string): Promise<boolean> {
  return (await loadDpdLogin(db, accountId)) !== null;
}
