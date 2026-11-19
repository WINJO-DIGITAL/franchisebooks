import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { decideDispatch, MAX_DISPATCHES_PER_NIGHT, missedSyncDeadline, syncNight } from "@/lib/jobs/nightly";

const window = (at: string, env: Record<string, string> = {}) =>
  execFileSync("bash", [".github/scripts/in-window.sh", at], { env: { ...process.env, ...env }, encoding: "utf8" }).trim();

describe("the GitHub run window (in-window.sh)", () => {
  it("runs in full inside the evening window, in GMT and in BST", () => {
    expect(window("2026-11-19 20:45Z")).toBe("true"); // 20:45 GMT
    expect(window("2026-07-01 19:45Z")).toBe("true"); // 20:45 BST
    expect(window("2026-11-19 20:15Z")).toBe("false");
  });
  it("lets a late scheduled run through (only if work is waiting) until 01:59 UK time", () => {
    expect(window("2026-11-19 22:00Z")).toBe("late");
    expect(window("2026-11-20 01:45Z")).toBe("late");
    expect(window("2026-07-01 23:30Z")).toBe("late"); // 00:30 BST
    expect(window("2026-11-20 02:15Z")).toBe("false");
    expect(window("2026-07-01 12:00Z")).toBe("false");
  });
  it("follows the repository's own window settings", () => {
    expect(window("2026-11-19 22:00Z", { LATE_END: "2200" })).toBe("late");
    expect(window("2026-11-19 22:15Z", { LATE_END: "2200" })).toBe("false");
  });
});

describe("starting the nightly sync run from the website", () => {
  const now = new Date("2026-11-19T20:40:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("starts it once reads are waiting", () => {
    expect(decideDispatch({ waiting: 2, running: 0, previous: [], now })).toMatchObject({ dispatch: true, attempt: 1 });
  });
  it("does nothing when nothing is waiting (the night's sync already succeeded) or a run is working", () => {
    expect(decideDispatch({ waiting: 0, running: 0, previous: [], now }).dispatch).toBe(false);
    expect(decideDispatch({ waiting: 2, running: 1, previous: [], now }).dispatch).toBe(false);
  });
  it("gives a started run half an hour, but retries one that could not be started after 5 minutes", () => {
    expect(decideDispatch({ waiting: 1, running: 0, previous: [{ attempt: 1, dispatchedAt: ago(10), started: true }], now }).dispatch).toBe(false);
    expect(decideDispatch({ waiting: 1, running: 0, previous: [{ attempt: 1, dispatchedAt: ago(31), started: true }], now })).toMatchObject({ dispatch: true, attempt: 2 });
    expect(decideDispatch({ waiting: 1, running: 0, previous: [{ attempt: 1, dispatchedAt: ago(6), started: false }], now })).toMatchObject({ dispatch: true, attempt: 2 });
  });
  it("stops after a few tries in one night", () => {
    const previous = Array.from({ length: MAX_DISPATCHES_PER_NIGHT }, (_, i) => ({ attempt: i + 1, dispatchedAt: ago(200 - i * 40), started: true }));
    expect(decideDispatch({ waiting: 1, running: 0, previous, now }).dispatch).toBe(false);
  });
  it("counts the hours after midnight as the night before", () => {
    expect(syncNight(new Date("2026-11-19T21:00:00Z"))).toBe("2026-11-19");
    expect(syncNight(new Date("2026-11-20T01:30:00Z"))).toBe("2026-11-19");
    expect(syncNight(new Date("2026-11-20T07:00:00Z"))).toBe("2026-11-20");
  });
});

describe("the 23:00 missed-sync deadline", () => {
  it("is 23:00 UK time, or an hour after a late sync time, never past 23:55", () => {
    expect(missedSyncDeadline("20:30")).toBe(23 * 60);
    expect(missedSyncDeadline("20:59")).toBe(23 * 60);
    expect(missedSyncDeadline("22:30")).toBe(23 * 60 + 30);
    expect(missedSyncDeadline("23:30")).toBe(23 * 60 + 55);
    expect(missedSyncDeadline("nonsense")).toBe(23 * 60);
  });
});
