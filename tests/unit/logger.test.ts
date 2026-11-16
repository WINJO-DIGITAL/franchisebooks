import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError, scrubSecrets } from "@/lib/logger";

const SECRET_VARS = ["DPD_PASSWORD", "DPD_USERNAME", "WORKER_AUTH_TOKEN", "CRON_SECRET", "ERROR_WEBHOOK_URL"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of SECRET_VARS) saved[name] = process.env[name];
});
afterEach(() => {
  for (const name of SECRET_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("scrubSecrets", () => {
  it("removes the values of configured secrets wherever they appear", () => {
    process.env.DPD_PASSWORD = "hunter2-correct-horse";
    process.env.WORKER_AUTH_TOKEN = "worker-token-1234";
    const out = scrubSecrets("login failed for hunter2-correct-horse; sent worker-token-1234 twice worker-token-1234");
    expect(out).not.toContain("hunter2-correct-horse");
    expect(out).not.toContain("worker-token-1234");
    expect(out.match(/\[redacted\]/g)).toHaveLength(3);
  });

  it("ignores secrets that are too short to be safely replaced", () => {
    process.env.DPD_USERNAME = "ab";
    expect(scrubSecrets("about the lab")).toBe("about the lab");
  });

  it("redacts bearer tokens, JWTs and Dropbox tokens", () => {
    expect(scrubSecrets("Authorization: Bearer abc.DEF-123_xyz")).toBe("Authorization: Bearer [redacted]");
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";
    expect(scrubSecrets(`token=${jwt}`)).toBe("token=[redacted-jwt]");
    expect(scrubSecrets("key sl.ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 end")).toBe("key [redacted-token] end");
  });

  it("leaves ordinary text alone", () => {
    expect(scrubSecrets("Drivers synced: 12 of 12")).toBe("Drivers synced: 12 of 12");
  });
});

describe("describeError", () => {
  it("scrubs secrets from message and stack, and caps the stack", () => {
    process.env.DPD_PASSWORD = "super-secret-pw";
    const error = new Error("could not sign in with super-secret-pw");
    const detail = describeError(error, { step: "login" });
    expect(detail.message).toBe("could not sign in with [redacted]");
    expect(detail.stack).not.toContain("super-secret-pw");
    expect(detail.stack!.split("\n").length).toBeLessThanOrEqual(12);
    expect(detail.step).toBe("login");
    expect(detail.name).toBe("Error");
  });

  it("copes with things that are not Error objects", () => {
    expect(describeError("plain text").message).toBe("plain text");
    expect(describeError({ code: 7 }).message).toBe('{"code":7}');
  });
});

describe("reportError", () => {
  it("does nothing external when no webhook is configured", async () => {
    delete process.env.ERROR_WEBHOOK_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { reportError } = await import("@/lib/logger");
    await reportError(new Error("quiet"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a scrubbed error to the webhook and never throws if that fails", async () => {
    process.env.ERROR_WEBHOOK_URL = "https://errors.example.test/hook";
    process.env.CRON_SECRET = "cron-secret-value";
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("ok")).mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const { reportError } = await import("@/lib/logger");

    await reportError(new Error("failed with cron-secret-value"), { path: "/x" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.error.message).toBe("failed with [redacted]");
    expect(body.context).toEqual({ path: "/x" });

    await expect(reportError(new Error("second"))).resolves.toBeUndefined();
  });
});
