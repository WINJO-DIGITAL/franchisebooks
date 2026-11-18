import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "@/lib/crypto";

const key = Buffer.alloc(32, 7);
const login = { username: "portal-user", password: "correct horse battery" };

describe("DPD login encryption", () => {
  it("round-trips the login with the right key", () => {
    expect(decryptJson<typeof login>(encryptJson(login, key), key)).toEqual(login);
  });

  it("never stores the password or username in plain text", () => {
    const stored = encryptJson(login, key);
    expect(stored).not.toContain("correct horse");
    expect(stored).not.toContain("portal-user");
  });

  it("refuses to open the login with a different key", () => {
    const stored = encryptJson(login, key);
    expect(() => decryptJson(stored, Buffer.alloc(32, 9))).toThrow();
  });

  it("uses a fresh nonce each time, so the same login never looks the same twice", () => {
    expect(encryptJson(login, key)).not.toBe(encryptJson(login, key));
  });
});
