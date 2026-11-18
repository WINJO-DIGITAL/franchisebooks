import { describe, expect, it } from "vitest";
import { mergeDpdConfig } from "@/lib/dpd/config";
import { dpdSetupReady, ownPortalMap } from "@/lib/dpd/readiness";
import { SHARED_PORTAL_MAP } from "@/lib/dpd/shared-map";
import { loadPortalMap } from "@/lib/dpd/sync";
import type { AdminClient } from "@/lib/supabase/admin";

type Row = { id: string; config: Record<string, unknown>; status: string };

/** A tiny in-memory stand-in for the integration_connections table. */
function fakeDb(row: Row | null) {
  const state = { row, inserted: null as unknown };
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.row }) }) }) }),
      update: (patch: Partial<Row>) => ({ eq: async () => { if (state.row) state.row = { ...state.row, ...patch }; return { error: null }; } }),
      insert: (value: Record<string, unknown>) => ({ select: () => ({ single: async () => { state.inserted = value; state.row = { id: "new", config: value.config as Record<string, unknown>, status: String(value.status) }; return { data: { id: "new" }, error: null }; } }) }),
    }),
  } as unknown as AdminClient;
  return { db, state };
}

describe("the shared DPD portal setup", () => {
  it("covers payments, charges and invoices", () => {
    expect(SHARED_PORTAL_MAP.reports.map((r) => r.id)).toEqual(["payments", "charges", "invoices"]);
  });

  it("is used for an account that has no map of its own", async () => {
    expect(await loadPortalMap(fakeDb(null).db, "a1")).toBe(SHARED_PORTAL_MAP);
    expect(await loadPortalMap(fakeDb({ id: "c", config: { loginSavedAt: "2026-11-18T00:00:00Z" }, status: "connected" }).db, "a1")).toBe(SHARED_PORTAL_MAP);
  });

  it("lets an account's own valid map override it", async () => {
    const own = { ...SHARED_PORTAL_MAP, delayMs: 4321 };
    const map = await loadPortalMap(fakeDb({ id: "c", config: { portalMap: own }, status: "connected" }).db, "a1");
    expect(map.delayMs).toBe(4321);
  });

  it("refuses an invalid own map instead of quietly using the shared one", async () => {
    await expect(loadPortalMap(fakeDb({ id: "c", config: { portalMap: { version: 99 } }, status: "connected" }).db, "a1")).rejects.toMatchObject({ plainEnglish: expect.stringMatching(/not valid/i) });
  });
});

describe("DPD sync readiness", () => {
  it("is ready only once the account's login has been saved", () => {
    expect(dpdSetupReady(null)).toBe(false);
    expect(dpdSetupReady({})).toBe(false);
    expect(dpdSetupReady({ portalMap: SHARED_PORTAL_MAP })).toBe(false);
    expect(dpdSetupReady({ loginSavedAt: "2026-11-18T09:00:00Z" })).toBe(true);
  });

  it("reads an account's own map override", () => {
    expect(ownPortalMap({})).toBeNull();
    expect(ownPortalMap({ portalMap: { x: 1 } })).toEqual({ x: 1 });
  });
});

describe("saving DPD settings", () => {
  it("keeps the other settings when one changes", async () => {
    const { db, state } = fakeDb({ id: "c", config: { loginSavedAt: "t1", portalMap: { x: 1 } }, status: "connected" });
    await mergeDpdConfig(db, "a1", "u1", { loginSavedAt: "t2" });
    expect(state.row?.config).toEqual({ loginSavedAt: "t2", portalMap: { x: 1 } });
  });

  it("removes only the key asked for", async () => {
    const { db, state } = fakeDb({ id: "c", config: { loginSavedAt: "t1", portalMap: { x: 1 } }, status: "connected" });
    await mergeDpdConfig(db, "a1", "u1", { portalMap: undefined });
    expect(state.row?.config).toEqual({ loginSavedAt: "t1" });
  });

  it("creates the connection when the account has none, without marking it ready", async () => {
    const { db, state } = fakeDb(null);
    const id = await mergeDpdConfig(db, "a1", "u1", {});
    expect(id).toBe("new");
    expect(dpdSetupReady(state.row?.config)).toBe(false);
  });
});
