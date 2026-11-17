/**
 * Minimal Dropbox API client (official HTTP API, OAuth 2.0 with refresh
 * tokens). Only read scopes are requested: files.metadata.read,
 * files.content.read and account_info.read.
 */

import { env } from "@/lib/env";

export class DropboxError extends Error {
  constructor(public readonly kind: "needs_reconnect" | "not_configured" | "not_found" | "cursor_reset" | "rate_limited" | "api", message: string, public readonly status?: number) {
    super(message);
    this.name = "DropboxError";
  }
}

export interface DropboxTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface DropboxEntry {
  tag: "file" | "folder" | "deleted";
  id?: string;
  name: string;
  pathLower: string;
  pathDisplay: string;
  size?: number;
  contentHash?: string;
  serverModified?: string;
}

export interface ListResult {
  entries: DropboxEntry[];
  cursor: string;
  hasMore: boolean;
}

type FetchLike = typeof fetch;

const AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";
export const DROPBOX_SCOPES = ["account_info.read", "files.metadata.read", "files.content.read"];

function appConfig() {
  const config = env.dropbox();
  if (!config) throw new DropboxError("not_configured", "Dropbox has not been set up for this app yet (the app key and secret are missing).");
  return config;
}

export function buildAuthorizeUrl(state: string): string {
  const config = appConfig();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.appKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("token_access_type", "offline");
  url.searchParams.set("redirect_uri", config.redirectUrl);
  url.searchParams.set("scope", DROPBOX_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params: Record<string, string>, fetchImpl: FetchLike): Promise<{ access_token: string; refresh_token?: string; expires_in: number; account_id?: string }> {
  const config = appConfig();
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${config.appKey}:${config.appSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(params).toString(),
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 400 && /invalid_grant/.test(text)) throw new DropboxError("needs_reconnect", "Dropbox access has expired or was withdrawn.", 400);
    throw new DropboxError("api", `Dropbox token request failed (${response.status})`, response.status);
  }
  return JSON.parse(text);
}

export async function exchangeCode(code: string, fetchImpl: FetchLike = fetch): Promise<{ tokens: DropboxTokens; accountId: string }> {
  const config = appConfig();
  const data = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: config.redirectUrl }, fetchImpl);
  if (!data.refresh_token || !data.account_id) throw new DropboxError("api", "Dropbox did not return a refresh token.");
  return {
    tokens: { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 },
    accountId: data.account_id,
  };
}

function toEntry(raw: Record<string, unknown>): DropboxEntry {
  return {
    tag: raw[".tag"] as DropboxEntry["tag"],
    id: raw.id as string | undefined,
    name: String(raw.name ?? ""),
    pathLower: String(raw.path_lower ?? ""),
    pathDisplay: String(raw.path_display ?? raw.path_lower ?? ""),
    size: raw.size as number | undefined,
    contentHash: raw.content_hash as string | undefined,
    serverModified: raw.server_modified as string | undefined,
  };
}

export class DropboxClient {
  constructor(
    private tokens: DropboxTokens,
    private readonly onTokensChanged: (tokens: DropboxTokens) => Promise<void>,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.tokens.expiresAt - Date.now() > 60_000) return this.tokens.accessToken;
    return this.refresh();
  }

  private async refresh(): Promise<string> {
    const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: this.tokens.refreshToken }, this.fetchImpl);
    this.tokens = { accessToken: data.access_token, refreshToken: data.refresh_token ?? this.tokens.refreshToken, expiresAt: Date.now() + data.expires_in * 1000 };
    await this.onTokensChanged(this.tokens);
    return this.tokens.accessToken;
  }

  private async request(url: string, init: (token: string) => RequestInit, attempt = 0): Promise<Response> {
    const response = await this.fetchImpl(url, init(await this.accessToken()));
    if (response.status === 401 && attempt === 0) {
      await this.refresh();
      return this.request(url, init, attempt + 1);
    }
    if (response.status === 401) throw new DropboxError("needs_reconnect", "Dropbox access has expired or was withdrawn.", 401);
    if (response.status === 429 && attempt < 3) {
      const wait = Math.min(Number(response.headers.get("retry-after") ?? "2"), 20);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return this.request(url, init, attempt + 1);
    }
    if (response.status === 429) throw new DropboxError("rate_limited", "Dropbox is limiting requests at the moment.", 429);
    if (response.status === 409) {
      const text = await response.text();
      if (/reset/.test(text)) throw new DropboxError("cursor_reset", "Dropbox asked for the folder to be re-read from the start.", 409);
      if (/not_found/.test(text)) throw new DropboxError("not_found", "That Dropbox folder or file no longer exists.", 409);
      throw new DropboxError("api", `Dropbox request was refused: ${text.slice(0, 200)}`, 409);
    }
    if (response.status >= 500 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      return this.request(url, init, attempt + 1);
    }
    if (!response.ok) throw new DropboxError("api", `Dropbox request failed (${response.status})`, response.status);
    return response;
  }

  private async rpc<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(`${API}${path}`, (token) => ({
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === null ? "null" : JSON.stringify(body),
    }));
    return (await response.json()) as T;
  }

  async currentAccount(): Promise<{ accountId: string; email: string; name: string }> {
    const data = await this.rpc<{ account_id: string; email: string; name: { display_name: string } }>("/users/get_current_account", null);
    return { accountId: data.account_id, email: data.email, name: data.name.display_name };
  }

  async listFolder(path: string, recursive: boolean): Promise<ListResult> {
    const data = await this.rpc<{ entries: Record<string, unknown>[]; cursor: string; has_more: boolean }>("/files/list_folder", {
      path: path === "/" ? "" : path, recursive, include_deleted: false, limit: 500,
    });
    return { entries: data.entries.map(toEntry), cursor: data.cursor, hasMore: data.has_more };
  }

  async listFolderContinue(cursor: string): Promise<ListResult> {
    const data = await this.rpc<{ entries: Record<string, unknown>[]; cursor: string; has_more: boolean }>("/files/list_folder/continue", { cursor });
    return { entries: data.entries.map(toEntry), cursor: data.cursor, hasMore: data.has_more };
  }

  async download(pathOrId: string): Promise<Uint8Array> {
    const response = await this.request(`${CONTENT}/files/download`, (token) => ({
      method: "POST",
      // The argument travels in a header; non-ASCII characters must be escaped.
      headers: { authorization: `Bearer ${token}`, "dropbox-api-arg": JSON.stringify({ path: pathOrId }).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) },
    }));
    return new Uint8Array(await response.arrayBuffer());
  }

  async revoke(): Promise<void> {
    await this.rpc("/auth/token/revoke", null).catch(() => undefined);
  }
}
