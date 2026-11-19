import { describe, expect, it } from "vitest";
import { buildCoverage } from "@/lib/history/coverage";
import { driverPerformance, lastYear, scopeStatus, summarisePeriods, type InsightDay } from "@/lib/history/insights";
import { historyPeriods } from "@/lib/history/window";

const day = (franchiseId: string, date: string, stops: number, parcels: number, gross: number, driverId: string | null = "d1"): InsightDay =>
  ({ franchiseId, driverId, driverKey: driverId ?? "x", date, stops, parcels, gross });

describe("period summaries", () => {
  const periods = historyPeriods("2026-11-19");
  const coverage = buildCoverage([
    { franchiseId: "f1", reportDate: "2026-10-12", status: "succeeded", result: {} },
    { franchiseId: "f2", reportDate: "2026-10-12", status: "succeeded", result: {} },
    { franchiseId: "f1", reportDate: "2026-09-14", status: "succeeded", result: {} },
    { franchiseId: "f1", reportDate: "2025-10-13", status: "succeeded", result: {} },
    { franchiseId: "f2", reportDate: "2025-10-13", status: "succeeded", result: { periodListed: false } },
  ]);
  const days = [day("f1", "2026-10-12", 100, 120, 21300), day("f1", "2026-10-13", 90, 100, 19200), day("f2", "2026-10-14", 50, 60, 10000)];

  it("adds up a read period, with income per stop and per parcel", () => {
    const [summary] = summarisePeriods(days, periods.filter((p) => p.start === "2026-10-12"), coverage, ["f1", "f2"]);
    expect(summary!.status).toBe("read");
    expect(summary!.figures).toEqual({ daysWithPayments: 3, income: 50500, stops: 240, parcels: 280, perStop: 210, perParcel: 180 });
  });

  it("shows a read period with no payments as zero, and an unread one with no figures", () => {
    const [read] = summarisePeriods(days, periods.filter((p) => p.start === "2026-09-14"), coverage, ["f1"]);
    expect(read!.figures).toEqual({ daysWithPayments: 0, income: 0, stops: 0, parcels: 0, perStop: null, perParcel: null });
    const [unread] = summarisePeriods(days, periods.filter((p) => p.start === "2026-08-17"), coverage, ["f1"]);
    expect(unread).toMatchObject({ status: "not_read", figures: null });
  });

  it("says when only some franchises have been read", () => {
    expect(scopeStatus(coverage, ["f1", "f2"], "2026-09-14")).toBe("partly_read");
    expect(scopeStatus(coverage, ["f2"], "2025-10-13")).toBe("not_listed");
    expect(scopeStatus(coverage, [], "2026-09-14")).toBe("not_read");
  });

  it("finds the same period last year", () => {
    const summaries = summarisePeriods(days, periods, coverage, ["f1"]);
    expect(lastYear(summaries, { start: "2026-10-12", end: "2026-11-08" })?.period.start).toBe("2025-10-13");
  });
});

describe("driver performance", () => {
  const periods = [
    { start: "2026-09-14", end: "2026-10-11", read: true },
    { start: "2026-10-12", end: "2026-11-08", read: true },
  ];

  it("compares stops per working day with the period before and flags a drop", () => {
    const days = [
      day("f1", "2026-09-14", 100, 110, 20000), day("f1", "2026-09-15", 100, 110, 20000),
      day("f1", "2026-10-12", 70, 80, 15000), day("f1", "2026-10-13", 70, 80, 15000),
    ];
    const [d] = driverPerformance(days, periods, 25);
    expect(d!.stopsByPeriod).toEqual([200, 140]);
    expect(d!.latest).toEqual({ days: 2, stops: 140, parcels: 160, pay: 30000, stopsPerDay: 70 });
    expect(d!.stopsPerDayChange).toBe(-30);
    expect(d!.dropped).toBe(true);
  });

  it("does not flag a small change, and keeps unread periods blank", () => {
    const days = [day("f1", "2026-09-14", 100, 110, 20000), day("f1", "2026-10-12", 90, 100, 18000)];
    const [d] = driverPerformance(days, periods, 25);
    expect(d!.dropped).toBe(false);
    const [u] = driverPerformance(days, [{ ...periods[0]!, read: false }, periods[1]!], 25);
    expect(u!.stopsByPeriod).toEqual([null, 90]);
    expect(u!.stopsPerDayChange).toBeNull();
  });

  it("keeps a driver DPD named but who is not registered yet", () => {
    const [d] = driverPerformance([day("f1", "2026-10-12", 50, 60, 9000, null)], periods, 25);
    expect(d!.key).toBe("unregistered:x");
  });
});
