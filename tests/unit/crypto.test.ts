import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bearerMatches, decryptJson, encryptJson, hmacSha256Hex, safeEqual, sha256Hex, signState, verifyState } from "@/lib/crypto";

const key = randomBytes(32);

describe("encryptJson / decryptJson", () => {
  it("round-trips structured values", () => {
    const value = { access_token: "sl.abc", expires: 123, nested: { ok: true, list: [1, "two", null] } };
    expect(decryptJson(encryptJson(value, key), key)).toEqual(value);
  });

  it("produces a different payload every time and never contains the plaintext", () => {
    const a = encryptJson({ secret: "visible?" }, key);
    const b = encryptJson({ secret: "visible?" }, key);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("visible");
    expect(Buffer.from(a.split(".")[3]!, "base64url").toString("utf8")).not.toContain("visible");
  });

  it("rejects the wrong key", () => {
    expect(() => decryptJson(encryptJson({ a: 1 }, key), randomBytes(32))).toThrow();
  });

  it("rejects tampering with any part", () => {
    const [v, iv, tag, ct] = encryptJson({ a: 1 }, key).split(".") as [string, string, string, string];
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(() => decryptJson([v, iv, tag, flip(ct)].join("."), key)).toThrow();
    expect(() => decryptJson([v, iv, flip(tag), ct].join("."), key)).toThrow();
    expect(() => decryptJson([v, flip(iv), tag, ct].join("."), key)).toThrow();
  });

  it("rejects payloads in an unknown format", () => {
    expect(() => decryptJson("garbage", key)).toThrow("Unrecognised encrypted payload");
    expect(() => decryptJson("v2.a.b.c", key)).toThrow("Unrecognised encrypted payload");
  });
});

describe("safeEqual and bearerMatches", () => {
  it("compares strings of any length", () => {
    expect(safeEqual("same", "same")).toBe(true);
    expect(safeEqual("same", "SAME")).toBe(false);
    expect(safeEqual("short", "a much longer string")).toBe(false);
  });

  it("accepts a correct bearer header only", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatches("bearer   s3cret ", "s3cret")).toBe(true);
    expect(bearerMatches("Bearer wrong", "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
    expect(bearerMatches("Basic s3cret", "s3cret")).toBe(false);
  });

  it("fails closed when either side is missing", () => {
    expect(bearerMatches(null, "s3cret")).toBe(false);
    expect(bearerMatches(undefined, "s3cret")).toBe(false);
    expect(bearerMatches("Bearer s3cret", null)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
  });
});

describe("hashes and signed state", () => {
  it("matches known SHA-256 and HMAC test vectors", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(sha256Hex("abc"));
  });

  it("verifies state it signed and rejects altered or foreign state", () => {
    const state = signState({ account: "a1", nonce: "n" }, key);
    expect(verifyState<{ account: string }>(state, key)).toEqual({ account: "a1", nonce: "n" });
    expect(verifyState(state, randomBytes(32))).toBeNull();
    const [body, sig] = state.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ account: "attacker", nonce: "n" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, key)).toBeNull();
    expect(verifyState(`${body}.`, key)).toBeNull();
    expect(verifyState("nodots", key)).toBeNull();
  });
});
