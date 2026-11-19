import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [name, value] of [["NEXT_PUBLIC_SUPABASE_URL", saved.url], ["NEXT_PUBLIC_SUPABASE_ANON_KEY", saved.key]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("GET /api/health", () => {
  it("reports ok when the database answers, without leaking configuration", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://db.test:54321/";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-value";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks).toEqual({ app: "ok", database: "ok" });
    expect(JSON.stringify(body)).not.toContain("anon-key-value");
    expect(JSON.stringify(body)).not.toContain("db.test");
    expect(body).not.toHaveProperty("version");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://db.test:54321/auth/v1/health");
  });

  it("returns 503 when the database cannot be reached", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://db.test:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).checks.database).toBe("failed");
  });

  it("is degraded but up when the database is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("degraded");
  });
});
