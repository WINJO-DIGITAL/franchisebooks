import "server-only";
import { decryptJson, encryptJson } from "@/lib/crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import { mergeDpdConfig } from "./config";
import { loadDpdLogin, type DpdLogin } from "./login";

export interface DpdLoginRow {
  id: string;
  label: string;
  username: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
}

/** Every login an account has listed. The passwords are never returned. */
export async function listDpdLogins(db: AdminClient, accountId: string): Promise<DpdLoginRow[]> {
  const { data } = await db
    .from("dpd_logins")
    .select("id, label, username, last_success_at, last_error, created_at")
    .eq("account_id", accountId)
    .order("created_at")
    .order("id");
  return (data ?? []).map((r) => ({ id: r.id, label: r.label, username: r.username, lastSuccessAt: r.last_success_at, lastError: r.last_error, createdAt: r.created_at }));
}

/** Adds another DPD login. The password is encrypted before it is stored. */
export async function addDpdLogin(db: AdminClient, accountId: string, userId: string, label: string, login: DpdLogin): Promise<string> {
  const { data: row, error } = await db
    .from("dpd_logins")
    .insert({ account_id: accountId, label: label.trim(), username: login.username.trim(), created_by: userId })
    .select("id")
    .single();
  if (error) {
    throw new Error(error.code === "23505" ? "That DPD username is already listed on this account." : `Could not add the login: ${error.message}`);
  }
  const { error: secretError } = await db.rpc("save_dpd_login_secret", { p_login_id: row.id, p_ciphertext: encryptJson({ username: login.username.trim(), password: login.password }) });
  if (secretError) throw new Error(`Could not store the DPD login: ${secretError.message}`);
  // Keep the account marked as ready for the nightly sync.
  await mergeDpdConfig(db, accountId, userId, { loginSavedAt: new Date().toISOString() }, "connected");
  return row.id;
}

/** Reads one listed login with its password, for the sync. Null if it cannot be read. */
export async function loadDpdLoginById(db: AdminClient, loginId: string): Promise<DpdLogin | null> {
  const { data: ciphertext, error } = await db.rpc("read_dpd_login_secret", { p_login_id: loginId });
  if (error || !ciphertext) return null;
  try {
    const login = decryptJson<DpdLogin>(ciphertext as string);
    return login.username && login.password ? login : null;
  } catch {
    return null;
  }
}

/** Every login the nightly sync should use, keyed by listed-login id. Accounts with only the original login get that one. */
export async function loadAllDpdLogins(db: AdminClient, accountId: string): Promise<Map<string, DpdLogin>> {
  const out = new Map<string, DpdLogin>();
  const listed = await listDpdLogins(db, accountId);
  for (const row of listed) {
    const login = await loadDpdLoginById(db, row.id);
    if (login) out.set(row.id, login);
  }
  // The original single login (set up at sign-up) is always kept, so adding a listed login never stops it being read.
  const original = await loadDpdLogin(db, accountId);
  if (original) out.set("original", original);
  return out;
}

export async function removeDpdLogin(db: AdminClient, accountId: string, loginId: string): Promise<void> {
  const { error } = await db.from("dpd_logins").delete().eq("id", loginId).eq("account_id", accountId);
  if (error) throw new Error(`Could not remove the login: ${error.message}`);
}

/** Records the outcome of a login's last read, so the list can say when it last worked or what went wrong. */
export async function recordLoginOutcome(db: AdminClient, loginId: string, patch: { success?: boolean; error?: string | null }): Promise<void> {
  await db.from("dpd_logins").update({
    ...(patch.success ? { last_success_at: new Date().toISOString() } : {}),
    last_error: patch.error ?? null,
  }).eq("id", loginId);
}
