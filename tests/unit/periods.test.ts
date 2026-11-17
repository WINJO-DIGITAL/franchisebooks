import { describe, expect, it } from "vitest";
import { lastCompletedPeriod, periodContaining, periodLabel, previousPeriod, recentPeriods } from "@/lib/finance/periods";

describe("DPD four-week periods", () => {
  it("matches the periods seen in the portal", () => {
    expect(periodContaining("2026-11-16")).toEqual({ start: "2026-11-09", end: "2026-12-06" });
    expect(periodContaining("2026-11-09")).toEqual({ start: "2026-11-09", end: "2026-12-06" });
    expect(periodContaining("2026-12-06")).toEqual({ start: "2026-11-09", end: "2026-12-06" });
    expect(periodContaining("2026-11-08")).toEqual({ start: "2026-10-12", end: "2026-11-08" });
    expect(periodContaining("2024-12-09")).toEqual({ start: "2024-12-09", end: "2025-01-05" });
    // the period that crosses a year boundary
    expect(periodContaining("2026-01-02")).toEqual({ start: "2025-12-08", end: "2026-01-04" });
    expect(periodContaining("2025-12-20")).toEqual({ start: "2025-12-08", end: "2026-01-04" });
  });

  it("every period starts on a Monday and runs Monday to Sunday", () => {
    for (const p of recentPeriods("2026-11-17", 30)) {
      expect(new Date(`${p.start}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(new Date(`${p.end}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  it("previousPeriod and recentPeriods step back 28 days with no gaps", () => {
    expect(previousPeriod({ start: "2026-11-09", end: "2026-12-06" })).toEqual({ start: "2026-10-12", end: "2026-11-08" });
    const list = recentPeriods("2026-11-17", 3);
    expect(list.map((p) => p.start)).toEqual(["2026-11-09", "2026-10-12", "2026-09-14"]);
  });

  it("the last completed period waits two days after the end so the final day's sync has run", () => {
    // Period ends Sunday 8 Nov 2026. Monday 9th: still too early. Tuesday 10th: due.
    expect(lastCompletedPeriod("2026-11-08")).toEqual({ start: "2026-09-14", end: "2026-10-11" });
    expect(lastCompletedPeriod("2026-11-09")).toEqual({ start: "2026-09-14", end: "2026-10-11" });
    expect(lastCompletedPeriod("2026-11-10")).toEqual({ start: "2026-10-12", end: "2026-11-08" });
    expect(lastCompletedPeriod("2026-11-17")).toEqual({ start: "2026-10-12", end: "2026-11-08" });
    expect(lastCompletedPeriod("2026-12-08")).toEqual({ start: "2026-11-09", end: "2026-12-06" });
  });

  it("labels a period with UK dates", () => {
    expect(periodLabel({ start: "2026-11-09", end: "2026-12-06" })).toBe("09/11/2026 to 06/12/2026");
  });
});
