import { describe, expect, it } from "vitest";
import { checkDemoSeedAllowed, hostOf } from "../../scripts/lib/guard";
import { DEMO_DRIVERS, generateEarnings, generateFuel, seeded } from "../../scripts/lib/demo-data";
import { addDays, weekdayOf } from "@/lib/dates";

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

describe("demo data", () => {
  const dates = Array.from({ length: 30 }, (_, i) => addDays("2026-10-16", i));
  const weekday = (d: string) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5;

  it("is deterministic", () => {
    expect(generateEarnings(dates, weekday)).toEqual(generateEarnings(dates, weekday));
    const a = seeded(1);
    const b = seeded(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("makes one row per driver per weekday, with consistent net earnings", () => {
    const rows = generateEarnings(dates, weekday);
    expect(rows).toHaveLength(dates.filter(weekday).length * DEMO_DRIVERS.length);
    for (const r of rows) {
      expect(r.net).toBeCloseTo(r.gross - r.deductions + r.additional, 2);
      expect(r.stops).toBeLessThanOrEqual(r.parcels);
    }
    expect(new Set(rows.map((r) => `${r.driver.ref}|${r.date}`)).size).toBe(rows.length);
  });

  it("gives every fuel transaction a unique reference", () => {
    const fuel = generateFuel(dates, weekday);
    expect(fuel.length).toBeGreaterThan(0);
    expect(new Set(fuel.map((f) => f.ref)).size).toBe(fuel.length);
  });
});
