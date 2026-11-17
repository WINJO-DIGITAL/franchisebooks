import { describe, expect, it } from "vitest";
import { checkDemoSeedAllowed, hostOf } from "../../scripts/lib/guard";

const allow = (supabaseUrl: string, env: Record<string, string | undefined> = {}) => checkDemoSeedAllowed({ supabaseUrl, env });

describe("demo seed guard", () => {
  it("allows a local database", () => {
    expect(allow("http://127.0.0.1:54321")).toMatchObject({ allowed: true, target: "local" });
    expect(allow("http://localhost:54321")).toMatchObject({ allowed: true, target: "local" });
  });

  it("refuses production however it is signalled", () => {
    expect(allow("https://abcd.supabase.co", { VERCEL_ENV: "production", ALLOW_DEMO_SEED_PREVIEW: "yes" }).allowed).toBe(false);
    expect(allow("https://abcd.supabase.co", { NODE_ENV: "production", ALLOW_DEMO_SEED_PREVIEW: "yes" }).allowed).toBe(false);
    expect(allow("https://abcd.supabase.co", { APP_ENV: "production", ALLOW_DEMO_SEED_PREVIEW: "yes" }).allowed).toBe(false);
    expect(allow("https://abcd.supabase.co", { PRODUCTION_SUPABASE_URL: "https://abcd.supabase.co/", ALLOW_DEMO_SEED_PREVIEW: "yes" }).allowed).toBe(false);
  });

  it("refuses any remote database unless a preview is confirmed in words", () => {
    expect(allow("https://preview.supabase.co").allowed).toBe(false);
    expect(allow("https://preview.supabase.co", { ALLOW_DEMO_SEED_PREVIEW: "true" }).allowed).toBe(false);
    expect(allow("https://preview.supabase.co", { ALLOW_DEMO_SEED_PREVIEW: "yes" })).toMatchObject({ allowed: true, target: "preview" });
  });

  it("refuses an unreadable address", () => {
    expect(allow("not a url").allowed).toBe(false);
    expect(hostOf("not a url")).toBeNull();
  });

  it("does not let a look-alike host pass as local", () => {
    expect(allow("https://127.0.0.1.evil.example").allowed).toBe(false);
    expect(allow("https://localhost.example.com").allowed).toBe(false);
  });
});
