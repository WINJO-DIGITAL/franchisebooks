import { describe, expect, it } from "vitest";
import { decideSchedule } from "@/lib/jobs/schedule";
import { retryDelayMinutes } from "@/lib/jobs/queue";
import { bearerMatches, decryptJson, encryptJson, hmacSha256Hex, safeEqual, signState, verifyState } from "@/lib/crypto";
import { scrubSecrets } from "@/lib/logger";
import { parseTimeToMinutes } from "@/lib/dates";

const settings = { syncEnabled: true, syncTimeLocal: "20:30:00", syncTimezone: "Europe/London" };

describe("evening sync schedule (UK time)", () => {
  it("is not due before the configured UK time and is due after it — in summer time", () => {
    expect(decideSchedule(settings, new Date("2026-07-01T19:29:00Z")).syncDue).toBe(false); // 20:29 BST
    expect(decideSchedule(settings, new Date("2026-07-01T19:31:00Z")).syncDue).toBe(true); // 20:31 BST
  });
  it("follows the clock change back to GMT", () => {
    expect(decideSchedule(settings, new Date("2026-12-01T20:29:00Z")).syncDue).toBe(false); // 20:29 GMT
    expect(decideSchedule(settings, new Date("2026-12-01T20:31:00Z")).syncDue).toBe(true);
    // 19:45 UTC is 20:45 in summer but 19:45 in winter.
    expect(decideSchedule(settings, new Date("2026-07-01T19:45:00Z")).syncDue).toBe(true);
    expect(decideSchedule(settings, new Date("2026-12-01T19:45:00Z")).syncDue).toBe(false);
  });
  it("collects the UK business date, even when UTC has already rolled over", () => {
    expect(decideSchedule(settings, new Date("2026-06-30T23:15:00Z")).reportDate).toBe("2026-07-01");
    expect(decideSchedule(settings, new Date("2026-06-30T22:15:00Z")).reportDate).toBe("2026-06-30");
  });
  it("can be switched off, and the time can be changed", () => {
    expect(decideSchedule({ ...settings, syncEnabled: false }, new Date("2026-07-01T23:00:00Z")).syncDue).toBe(false);
    expect(decideSchedule({ ...settings, syncTimeLocal: "22:00" }, new Date("2026-07-01T20:30:00Z")).syncDue).toBe(false); // 21:30 BST
    expect(decideSchedule({ ...settings, syncTimeLocal: "22:00" }, new Date("2026-07-01T21:30:00Z")).syncDue).toBe(true);
  });
  it("makes last month's report due from the 2nd", () => {
    expect(decideSchedule(settings, new Date("2026-12-01T12:00:00Z")).reportMonthDue).toBeNull();
    expect(decideSchedule(settings, new Date("2026-12-02T12:00:00Z")).reportMonthDue).toBe("2026-11");
    expect(decideSchedule(settings, new Date("2027-01-05T12:00:00Z")).reportMonthDue).toBe("2026-12");
  });
  it("falls back to the default time if the stored one is unreadable", () => {
    expect(parseTimeToMinutes("garbage")).toBeNull();
    expect(decideSchedule({ ...settings, syncTimeLocal: "garbage" }, new Date("2026-07-01T19:31:00Z")).syncDue).toBe(true);
  });
});

describe("retry backoff", () => {
  it("backs off exponentially with a ceiling", () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMinutes)).toEqual([2, 8, 32, 120, 120]);
  });
});

describe("machine authentication and secrets", () => {
  it("compares bearer secrets safely", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("Bearer wrong", "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
    expect(bearerMatches(null, "s3cret")).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer x", undefined)).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("verifies Dropbox-style webhook signatures", () => {
    const body = JSON.stringify({ list_folder: { accounts: ["dbid:1"] } });
    const sig = hmacSha256Hex("app-secret", body);
    expect(safeEqual(sig, hmacSha256Hex("app-secret", body))).toBe(true);
    expect(safeEqual(sig, hmacSha256Hex("other", body))).toBe(false);
    expect(safeEqual(sig, hmacSha256Hex("app-secret", body + " "))).toBe(false);
  });
  const key = Buffer.alloc(32, 7);
  it("encrypts stored tokens and detects tampering", () => {
    const payload = { accessToken: "sl.abc", refreshToken: "r-123", expiresAt: 1 };
    const enc = encryptJson(payload, key);
    expect(enc).not.toContain("sl.abc");
    expect(decryptJson(enc, key)).toEqual(payload);
    expect(encryptJson(payload, key)).not.toBe(enc); // fresh IV each time
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptJson(parts.join("."), key)).toThrow();
    expect(() => decryptJson(enc, Buffer.alloc(32, 9))).toThrow();
  });
  it("signs OAuth state so it cannot be forged", () => {
    const state = signState({ accountId: "a", exp: 1 }, key);
    expect(verifyState(state, key)).toEqual({ accountId: "a", exp: 1 });
    expect(verifyState(state.replace(/.$/, "x"), key)).toBeNull();
    expect(verifyState("nonsense", key)).toBeNull();
    const [body] = state.split(".");
    expect(verifyState(`${body}.AAAA`, key)).toBeNull();
  });
  it("removes credentials from text before it is logged or shown", () => {
    process.env.DPD_PASSWORD = "hunter2-hunter2";
    const cleaned = scrubSecrets("login failed for password hunter2-hunter2 with Bearer abc.def.ghi and sl.AAAAAAAAAAAAAAAAAAAAAAAA");
    expect(cleaned).not.toContain("hunter2-hunter2");
    expect(cleaned).not.toContain("abc.def.ghi");
    expect(cleaned).not.toMatch(/sl\.A{10}/);
    delete process.env.DPD_PASSWORD;
  });
});
