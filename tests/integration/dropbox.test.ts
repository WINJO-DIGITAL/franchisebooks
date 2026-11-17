import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { encryptJson } from "@/lib/crypto";
import { DropboxClient, DropboxError, buildAuthorizeUrl } from "@/lib/dropbox/client";
import { runDropboxSync } from "@/lib/dropbox/sync";
import { GET as webhookChallenge, POST as webhookPost } from "@/app/api/dropbox/webhook/route";
import { hmacSha256Hex } from "@/lib/crypto";
import { adminClient } from "../helpers/app";
import { createTestAccount, pool, sql, type TestAccount } from "../helpers/db";
import { earningsPdf, fuelCsv } from "../fixtures/synthetic";
import { NextRequest } from "next/server";

const db = adminClient();
let t: TestAccount;
let connectionId: string;

interface FakeFile { id: string; name: string; path: string; bytes: Buffer }

/** A tiny in-memory Dropbox: folders, cursors, token refresh and downloads. */
function fakeDropbox(state: { files: FakeFile[]; seen: Map<string, number>; refreshFails?: boolean; calls: string[] }): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    state.calls.push(url.replace("https://", ""));
    if (url.endsWith("/oauth2/token")) {
      if (state.refreshFails) return new Response('{"error":"invalid_grant"}', { status: 400 });
      return json({ access_token: "fresh-access", expires_in: 14400 });
    }
    const auth = new Headers(init?.headers).get("authorization");
    if (!auth?.startsWith("Bearer ")) return new Response("no auth", { status: 401 });
    if (url.endsWith("/files/list_folder")) {
      const entries = state.files.map((f) => ({ ".tag": "file", id: f.id, name: f.name, path_lower: f.path.toLowerCase(), path_display: f.path, size: f.bytes.length, content_hash: `h-${f.id}`, server_modified: "2026-11-14T20:00:00Z" }));
      return json({ entries, cursor: `cursor-${state.files.length}`, has_more: false });
    }
    if (url.endsWith("/files/list_folder/continue")) {
      const cursor = JSON.parse(String(init?.body)).cursor as string;
      const known = Number(cursor.split("-")[1]);
      const entries = state.files.slice(known).map((f) => ({ ".tag": "file", id: f.id, name: f.name, path_lower: f.path.toLowerCase(), path_display: f.path, size: f.bytes.length, content_hash: `h-${f.id}`, server_modified: "2026-11-14T20:00:00Z" }));
      return json({ entries, cursor: `cursor-${state.files.length}`, has_more: false });
    }
    if (url.endsWith("/files/download")) {
      const arg = JSON.parse(new Headers(init?.headers).get("dropbox-api-arg") ?? "{}") as { path: string };
      const file = state.files.find((f) => f.id === arg.path);
      state.seen.set(arg.path, (state.seen.get(arg.path) ?? 0) + 1);
      return file ? new Response(new Uint8Array(file.bytes)) : new Response("{}", { status: 409 });
    }
    if (url.endsWith("/users/get_current_account")) return json({ account_id: "dbid:test", email: "owner@example.test", name: { display_name: "Test Owner" } });
    return new Response("unexpected " + url, { status: 500 });
  }) as typeof fetch;
}

async function storeTokens(expiresAt: number) {
  await db.rpc("save_integration_secret", { p_connection_id: connectionId, p_ciphertext: encryptJson({ accessToken: "old-access", refreshToken: "refresh-1", expiresAt }) });
}

beforeAll(async () => {
  process.env.DROPBOX_APP_KEY = "test-key";
  process.env.DROPBOX_APP_SECRET = "test-secret";
  process.env.DROPBOX_REDIRECT_URL = "http://localhost:3000/api/dropbox/callback";
  t = await createTestAccount("Dropbox Test");
  const [conn] = await sql<{ id: string }>(
    "insert into public.integration_connections (account_id, provider, status, display_name, external_account_id) values ($1, 'dropbox', 'connected', 'owner@example.test', 'dbid:test') returning id", [t.accountId],
  );
  connectionId = conn!.id;
  await sql("insert into public.integration_folders (account_id, connection_id, path_display, path_lower, default_franchise_id) values ($1, $2, '/DPD Reports', '/dpd reports', $3)", [t.accountId, connectionId, t.franchiseId]);
}, 60_000);
afterAll(() => pool.end());
beforeEach(async () => {
  await sql("update public.integration_connections set status = 'connected' where id = $1", [connectionId]);
});

describe("Dropbox OAuth", () => {
  it("builds an authorisation URL asking for offline, read-only access", () => {
    const url = new URL(buildAuthorizeUrl("state123"));
    expect(url.origin + url.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-key");
    expect(url.searchParams.get("token_access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/dropbox/callback");
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual(["account_info.read", "files.metadata.read", "files.content.read"]);
    expect(scopes.some((s) => s.includes("write"))).toBe(false);
  });
  it("refreshes an expired access token and stores the new one", async () => {
    const saved: string[] = [];
    const state = { files: [], seen: new Map<string, number>(), calls: [] as string[] };
    const client = new DropboxClient({ accessToken: "old", refreshToken: "refresh-1", expiresAt: Date.now() - 1000 }, async (tokens) => void saved.push(tokens.accessToken), fakeDropbox(state));
    await client.currentAccount();
    expect(saved).toEqual(["fresh-access"]);
    expect(state.calls[0]).toContain("oauth2/token");
  });
  it("reports a revoked connection as needing to be reconnected", async () => {
    const state = { files: [], seen: new Map<string, number>(), calls: [] as string[], refreshFails: true };
    const client = new DropboxClient({ accessToken: "old", refreshToken: "r", expiresAt: 0 }, async () => undefined, fakeDropbox(state));
    await expect(client.currentAccount()).rejects.toMatchObject({ kind: "needs_reconnect" });
    await expect(client.currentAccount()).rejects.toBeInstanceOf(DropboxError);
  });
});

describe("Dropbox folder sync", () => {
  const state = { files: [] as FakeFile[], seen: new Map<string, number>(), calls: [] as string[], refreshFails: false };
  const run = () => runDropboxSync(db, t.accountId, { fetchImpl: fakeDropbox(state) });

  it("imports new earnings and fuel documents, matched to the franchise", async () => {
    await storeTokens(Date.now() + 3_600_000);
    state.files = [
      { id: "id:1", name: "earnings-2026-11-14.pdf", path: "/DPD Reports/earnings-2026-11-14.pdf", bytes: await earningsPdf({ fdNumber: t.fdNumber, date: "2026-11-14" }) },
      { id: "id:2", name: "fuel-w46.csv", path: "/DPD Reports/fuel-w46.csv", bytes: fuelCsv([{ date: "2026-11-12", registration: "AB12 CDE", site: "Synthetic Services", litres: 50, pricePerLitre: 1.45, reference: "DBX-1" }], { fdNumber: t.fdNumber, totals: true }) },
      { id: "id:3", name: "holiday.jpg", path: "/DPD Reports/holiday.jpg", bytes: Buffer.from([1, 2, 3]) },
    ];
    const result = await run();
    expect(result).toMatchObject({ status: "succeeded", detected: 3, imported: 2, skipped: 1, failed: 0, needsAttention: 0 });
    expect(result.message).toContain("2 imported");
    const files = await sql<{ source: string; source_ref: string; status: string }>("select source, source_ref, status from public.imported_files where account_id = $1 and source = 'dropbox' order by original_filename", [t.accountId]);
    expect(files).toHaveLength(2);
    expect(files.every((f) => f.status === "imported" && f.source_ref.startsWith("dropbox:"))).toBe(true);
    expect(await sql("select id from public.daily_earnings where account_id = $1", [t.accountId])).toHaveLength(4);
    const [conn] = await sql<{ last_success_at: Date | null; status: string }>("select last_success_at, status from public.integration_connections where id = $1", [connectionId]);
    expect(conn!.status).toBe("connected");
    expect(conn!.last_success_at).not.toBeNull();
    const [folder] = await sql<{ cursor: string | null }>("select cursor from public.integration_folders where connection_id = $1", [connectionId]);
    expect(folder!.cursor).toBe("cursor-3");
  });

  it("only looks at what changed since the last run, without re-downloading", async () => {
    state.seen.clear();
    const again = await run();
    expect(again).toMatchObject({ status: "succeeded", detected: 0, imported: 0 });
    expect(again.message).toContain("no new files");
    expect(state.seen.size).toBe(0);
  });

  it("ignores a renamed copy of a file it has already imported", async () => {
    state.files.push({ id: "id:4", name: "earnings-copy.pdf", path: "/DPD Reports/earnings-copy.pdf", bytes: state.files[0]!.bytes });
    const result = await run();
    expect(result).toMatchObject({ detected: 1, imported: 0, duplicates: 1 });
    expect(await sql("select id from public.daily_earnings where account_id = $1", [t.accountId])).toHaveLength(4);
  });

  it("flags a document that disagrees with stored figures instead of overwriting", async () => {
    const changed = await earningsPdf({ fdNumber: t.fdNumber, date: "2026-11-14", rows: [{ driver: "Alex Example", driverId: "T1001", route: "R01", parcels: 142, stops: 118, payPerParcel: 0.45, payPerStop: 0.85 }] });
    state.files.push({ id: "id:5", name: "earnings-revised.pdf", path: "/DPD Reports/earnings-revised.pdf", bytes: changed });
    const result = await run();
    expect(result.status).toBe("partial");
    expect(result.needsAttention).toBe(1);
    const [alex] = await sql<{ stops: number }>("select stops from public.daily_earnings where account_id = $1 and source_driver_name = 'Alex Example' and is_current", [t.accountId]);
    expect(alex!.stops).toBe(108);
    expect(await sql("select id from public.review_items where account_id = $1 and kind = 'source_conflict' and status = 'open'", [t.accountId])).toHaveLength(1);
  });

  it("asks the owner to reconnect when access has been withdrawn", async () => {
    await storeTokens(0);
    state.refreshFails = true;
    const result = await run();
    expect(result.status).toBe("blocked");
    expect(result.message).toBe("Dropbox needs reconnecting.");
    const [conn] = await sql<{ status: string }>("select status from public.integration_connections where id = $1", [connectionId]);
    expect(conn!.status).toBe("needs_reconnect");
    state.refreshFails = false;
  });

  it("does nothing, and says why, when no folder has been chosen", async () => {
    const other = await createTestAccount("No Folders");
    const [c] = await sql<{ id: string }>("insert into public.integration_connections (account_id, provider, status) values ($1, 'dropbox', 'connected') returning id", [other.accountId]);
    await db.rpc("save_integration_secret", { p_connection_id: c!.id, p_ciphertext: encryptJson({ accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 1e7 }) });
    const result = await runDropboxSync(db, other.accountId, { fetchImpl: fakeDropbox(state) });
    expect(result.status).toBe("blocked");
    expect(result.message).toContain("no folders have been chosen");
  });
});

describe("Dropbox webhook", () => {
  const post = (body: string, signature?: string) =>
    webhookPost(new NextRequest("http://localhost/api/dropbox/webhook", { method: "POST", body, headers: signature ? { "x-dropbox-signature": signature } : {} }));

  it("echoes the verification challenge", async () => {
    const response = await webhookChallenge(new NextRequest("http://localhost/api/dropbox/webhook?challenge=abc123"));
    expect(await response.text()).toBe("abc123");
    expect((await webhookChallenge(new NextRequest("http://localhost/api/dropbox/webhook"))).status).toBe(400);
  });
  it("rejects requests that are not signed by Dropbox", async () => {
    const body = JSON.stringify({ list_folder: { accounts: ["dbid:test"] } });
    expect((await post(body)).status).toBe(403);
    expect((await post(body, "deadbeef")).status).toBe(403);
    expect((await post(body, hmacSha256Hex("wrong-secret", body))).status).toBe(403);
    expect((await post(body, hmacSha256Hex("test-secret", body + "x"))).status).toBe(403);
    expect(await sql("select id from public.import_jobs where account_id = $1 and job_type = 'dropbox_sync' and trigger = 'webhook'", [t.accountId])).toEqual([]);
  });
  it("accepts a correctly signed notification for an unknown account without queueing anything", async () => {
    const body = JSON.stringify({ list_folder: { accounts: ["dbid:nobody"] } });
    const response = await post(body, hmacSha256Hex("test-secret", body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, queued: 0 });
  });
});
