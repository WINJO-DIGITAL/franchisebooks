import "server-only";
import { decryptJson, encryptJson } from "@/lib/crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import { DropboxClient, DropboxError, type DropboxTokens } from "./client";

export interface DropboxConnection {
  id: string;
  accountId: string;
  status: string;
  displayName: string | null;
}

export async function saveTokens(db: AdminClient, connectionId: string, tokens: DropboxTokens): Promise<void> {
  const { error } = await db.rpc("save_integration_secret", { p_connection_id: connectionId, p_ciphertext: encryptJson(tokens) });
  if (error) throw new Error(`Could not store the Dropbox connection: ${error.message}`);
}

/** Opens an API client for an account's Dropbox connection, refreshing and re-saving tokens as needed. */
export async function openDropbox(db: AdminClient, accountId: string, fetchImpl: typeof fetch = fetch): Promise<{ client: DropboxClient; connection: DropboxConnection }> {
  const { data: row } = await db.from("integration_connections").select("id, account_id, status, display_name").eq("account_id", accountId).eq("provider", "dropbox").maybeSingle();
  if (!row || row.status === "disconnected") throw new DropboxError("needs_reconnect", "Dropbox is not connected.");
  const { data: ciphertext, error } = await db.rpc("read_integration_secret", { p_connection_id: row.id });
  if (error || !ciphertext) throw new DropboxError("needs_reconnect", "Dropbox needs reconnecting.");
  let tokens: DropboxTokens;
  try {
    tokens = decryptJson<DropboxTokens>(ciphertext as string);
  } catch {
    throw new DropboxError("needs_reconnect", "Dropbox needs reconnecting.");
  }
  const client = new DropboxClient(tokens, (updated) => saveTokens(db, row.id, updated), fetchImpl);
  return { client, connection: { id: row.id, accountId: row.account_id, status: row.status, displayName: row.display_name } };
}

export async function markNeedsReconnect(db: AdminClient, accountId: string, reason: string): Promise<void> {
  await db.from("integration_connections").update({ status: "needs_reconnect", last_error: reason, last_sync_at: new Date().toISOString() }).eq("account_id", accountId).eq("provider", "dropbox");
}
