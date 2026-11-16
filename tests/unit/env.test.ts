import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, MissingConfigError } from "@/lib/env";

const NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APP_URL", "VERCEL_URL", "ENCRYPTION_KEY",
  "CRON_SECRET", "WORKER_URL", "WORKER_AUTH_TOKEN", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_REDIRECT_URL",
  "DPD_PORTAL_URL", "DPD_USERNAME", "DPD_PASSWORD", "DPD_LOGIN_SECRET", "LOG_LEVEL", "ERROR_WEBHOOK_URL",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const n of NAMES) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
});
afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe("required values", () => {
  it("throws a MissingConfigError with a plain-English message", () => {
    expect(() => env.supabaseUrl()).toThrow(MissingConfigError);
    try {
      env.supabaseServiceRoleKey();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MissingConfigError);
      expect((e as MissingConfigError).variable).toBe("SUPABASE_SERVICE_ROLE_KEY");
      expect((e as MissingConfigError).plainEnglish).toMatch(/server database key/);
    }
  });

  it("treats whitespace-only values as missing and trims real ones", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "   ";
    expect(() => env.supabaseUrl()).toThrow(MissingConfigError);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "  http://127.0.0.1:54321 ";
    expect(env.supabaseUrl()).toBe("http://127.0.0.1:54321");
  });
});

describe("encryptionKey", () => {
  it("accepts exactly 32 bytes of base64", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(env.encryptionKey()).toHaveLength(32);
  });

  it("rejects keys of the wrong length", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 7).toString("base64");
    try {
      env.encryptionKey();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MissingConfigError);
      expect((e as MissingConfigError).plainEnglish).toMatch(/32 bytes/);
    }
  });
});

describe("appUrl", () => {
  it("prefers APP_URL and strips a trailing slash", () => {
    process.env.APP_URL = "https://app.example.test/";
    process.env.VERCEL_URL = "preview.vercel.app";
    expect(env.appUrl()).toBe("https://app.example.test");
  });

  it("falls back to the Vercel URL, then localhost", () => {
    process.env.VERCEL_URL = "preview.vercel.app";
    expect(env.appUrl()).toBe("https://preview.vercel.app");
    delete process.env.VERCEL_URL;
    expect(env.appUrl()).toBe("http://localhost:3000");
  });
});

describe("optional integrations", () => {
  it("returns null for Dropbox until both key and secret exist, then defaults the redirect", () => {
    process.env.DROPBOX_APP_KEY = "key";
    expect(env.dropbox()).toBeNull();
    process.env.DROPBOX_APP_SECRET = "secret";
    process.env.APP_URL = "https://app.example.test";
    expect(env.dropbox()).toEqual({ appKey: "key", appSecret: "secret", redirectUrl: "https://app.example.test/api/dropbox/callback" });
    process.env.DROPBOX_REDIRECT_URL = "https://other.test/cb";
    expect(env.dropbox()?.redirectUrl).toBe("https://other.test/cb");
  });

  it("returns DPD settings only when complete and the URL is valid", () => {
    expect(env.dpd()).toBeNull();
    process.env.DPD_PORTAL_URL = "not a url";
    process.env.DPD_USERNAME = "user";
    process.env.DPD_PASSWORD = "pass";
    expect(env.dpd()).toBeNull();
    process.env.DPD_PORTAL_URL = "https://portal.example.test";
    expect(env.dpd()).toEqual({ url: "https://portal.example.test", username: "user", password: "pass", loginSecret: null });
    process.env.DPD_LOGIN_SECRET = "extra";
    expect(env.dpd()?.loginSecret).toBe("extra");
    delete process.env.DPD_PASSWORD;
    expect(env.dpd()).toBeNull();
  });

  it("normalises the worker URL and defaults the log level", () => {
    expect(env.workerUrl()).toBeNull();
    process.env.WORKER_URL = "https://worker.example.test/";
    expect(env.workerUrl()).toBe("https://worker.example.test");
    expect(env.logLevel()).toBe("info");
    process.env.LOG_LEVEL = "debug";
    expect(env.logLevel()).toBe("debug");
    expect(env.cronSecret()).toBeNull();
    expect(env.errorWebhookUrl()).toBeNull();
  });
});
