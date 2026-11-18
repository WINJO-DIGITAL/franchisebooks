import { describe, expect, it } from "vitest";
import { STAGGER_WINDOW_MINUTES, staggerOffsetMinutes, staggeredSyncTime } from "@/lib/jobs/schedule";

describe("staggering nightly reads", () => {
  it("gives the same account the same offset every time, within the window", () => {
    const a = staggerOffsetMinutes("11111111-2222-3333-4444-555555555555");
    expect(staggerOffsetMinutes("11111111-2222-3333-4444-555555555555")).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(STAGGER_WINDOW_MINUTES);
  });

  it("spreads many accounts across the window rather than bunching them", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) seen.add(staggerOffsetMinutes(`account-${i}`));
    expect(seen.size).toBeGreaterThanOrEqual(STAGGER_WINDOW_MINUTES - 2);
  });

  it("starts an account between its chosen time and the end of the window", () => {
    for (let i = 0; i < 50; i++) {
      const t = staggeredSyncTime("20:30", `account-${i}`);
      expect(t >= "20:30" && t < "21:00").toBe(true);
    }
  });

  it("returns an unreadable time unchanged rather than guessing", () => {
    expect(staggeredSyncTime("nonsense", "account-1")).toBe("nonsense");
  });

  it("wraps past midnight correctly", () => {
    const t = staggeredSyncTime("23:59", "account-1", 30);
    expect(t).toMatch(/^\d{2}:\d{2}$/);
  });
});
