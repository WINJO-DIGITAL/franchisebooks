/** Encryption for stored OAuth tokens, and constant-time secret comparison. */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encryptJson(value: unknown, key: Buffer = env.encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptJson<T>(payload: string, key: Buffer = env.encryptionKey()): T {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unrecognised encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}

/** Constant-time string comparison (hashing first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Checks an "Authorization: Bearer <secret>" header against the expected secret. */
export function bearerMatches(header: string | null | undefined, expected: string | null | undefined): boolean {
  if (!header || !expected) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return !!match && safeEqual(match[1]!, expected);
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hmacSha256Hex(secret: string, body: Uint8Array | string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Signs a short-lived state value (used for the OAuth "state" parameter). */
export function signState(data: Record<string, unknown>, key: Buffer = env.encryptionKey()): string {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyState<T>(state: string, key: Buffer = env.encryptionKey()): T | null {
  const [body, signature] = state.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
