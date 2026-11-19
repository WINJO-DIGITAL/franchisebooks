import { describe, expect, it } from "vitest";
import { buildCoverage, periodReadStatus } from "@/lib/history/coverage";
import { pickHistoryReads } from "@/lib/history/pick";
import { historyPeriods, historyWindow, sameTimeLastYear, taxYearLabel, taxYearStart } from "@/lib/history/window";

describe("tax years", () => {
  it("starts on 6 April", () => {
    expect(taxYearStart("2026-11-19")).toBe("2026-04-06");
    expect(taxYearStart("2026-04-06")).toBe("2026-04-06");
    expect(taxYearStart("2026-04-05")).toBe("2025-04-06");
    expect(taxYearStart("2027-01-10")).toBe("2026-04-06");
  });

  it("is labelled like 2025/26", () => {
    expect(taxYearLabel("2026-11-19")).toBe("2026/27");
    expect(taxYearLabel("2026-04-05")).toBe("2025/26");
    expect(taxYearLabel("2099-05-01")).toBe("2099/00");
  });
});

describe("the history window", () => {
  it("covers the current and previous tax year up to today", () => {
    expect(historyWindow("2026-11-19")).toEqual({ start: "2025-04-06", end: "2026-11-19" });
    expect(historyWindow("2026-03-01")).toEqual({ start: "2024-04-06", end: "2026-03-01" });
  });

  it("lists every DPD period that overlaps it, newest first, and labels the edges", () => {
    const periods = historyPeriods("2026-11-19");
    expect(periods[0]).toEqual({ start: "2026-11-09", end: "2026-12-06", startsBeforeWindow: false, current: true });
    const oldest = periods[periods.length - 1]!;
    expect(oldest).toEqual({ start: "2025-03-31", end: "2025-04-27", startsBeforeWindow: true, current: false });
    expect(periods).toHaveLength(22);
    expect(periods.filter((p) => p.current)).toHaveLength(1);
    expect(periods.filter((p) => p.startsBeforeWindow)).toHaveLength(1);
    // Back to back, with no gaps.
    for (let i = 1; i < periods.length; i++) expect(periods[i]!.end < periods[i - 1]!.start).toBe(true);
  });

  it("finds the same period last year, 13 periods back", () => {
    expect(sameTimeLastYear({ start: "2026-11-09", end: "2026-12-06" })).toEqual({ start: "2025-11-10", end: "2025-12-07" });
  });
});

describe("which periods have been read", () => {
  const coverage = buildCoverage([
    { franchiseId: "f1", reportDate: "2026-11-19", status: "succeeded", result: { inserted: 0 } },
    { franchiseId: "f1", reportDate: "2026-10-12", status: "failed", result: null },
    { franchiseId: "f1", reportDate: "2025-04-01", status: "succeeded", result: { periodListed: false } },
    { franchiseId: "f1", reportDate: "2026-09-14", status: "queued", result: null },
    { franchiseId: "f1", reportDate: "2026-08-17", status: "succeeded", result: { periodListed: false } },
    { franchiseId: "f1", reportDate: "2026-08-20", status: "partial", result: { inserted: 4 } },
    { franchiseId: null, reportDate: "2026-11-19", status: "succeeded", result: null },
  ]);

  it("counts a successful read with no payments as read, so its days are a true zero", () => {
    expect(periodReadStatus(coverage, "f1", "2026-11-09")).toBe("read");
  });

  it("keeps a failed read as not read, never zero", () => {
    expect(periodReadStatus(coverage, "f1", "2026-10-12")).toBe("not_read");
  });

  it("marks a period DPD does not list, and lets any later read win", () => {
    expect(periodReadStatus(coverage, "f1", "2025-03-31")).toBe("not_listed");
    expect(periodReadStatus(coverage, "f1", "2026-08-17")).toBe("read");
  });

  it("shows a waiting read as queued, and an unknown franchise as not read", () => {
    expect(periodReadStatus(coverage, "f1", "2026-09-14")).toBe("queued");
    expect(periodReadStatus(coverage, "f2", "2026-11-09")).toBe("not_read");
  });
});

describe("choosing history reads", () => {
  const periods = historyPeriods("2026-11-19");
  const base = { franchiseIds: ["f1", "f2"], periods, failures: new Map<string, number>(), failureLimit: 3, limit: 3 };

  it("takes the newest unread past periods first, a few per franchise, never the current period", () => {
    const picks = pickHistoryReads({ ...base, coverage: buildCoverage([]) });
    expect(picks.filter((p) => p.franchiseId === "f1").map((p) => p.periodStart)).toEqual(["2026-10-12", "2026-09-14", "2026-08-17"]);
    expect(picks.filter((p) => p.franchiseId === "f2")).toHaveLength(3);
    expect(picks.some((p) => p.periodStart === "2026-11-09")).toBe(false);
  });

  it("skips periods already read, queued or not listed, and ones that keep failing", () => {
    const coverage = buildCoverage([
      { franchiseId: "f1", reportDate: "2026-10-12", status: "succeeded", result: {} },
      { franchiseId: "f1", reportDate: "2026-09-14", status: "queued", result: null },
      { franchiseId: "f1", reportDate: "2026-08-17", status: "succeeded", result: { periodListed: false } },
    ]);
    const failures = new Map([["f1|2026-07-20", 3]]);
    const picks = pickHistoryReads({ ...base, franchiseIds: ["f1"], coverage, failures });
    expect(picks.map((p) => p.periodStart)).toEqual(["2026-06-22", "2026-05-25", "2026-04-27"]);
  });

  it("stops once every period in the window is accounted for", () => {
    const jobs = periods.map((p) => ({ franchiseId: "f1", reportDate: p.start, status: "succeeded", result: {} }));
    expect(pickHistoryReads({ ...base, franchiseIds: ["f1"], coverage: buildCoverage(jobs) })).toEqual([]);
  });
});

describe("the nightly limit", () => {
  it("counts reads already queued tonight", () => {
    const picks = pickHistoryReads({
      franchiseIds: ["f1", "f2"], periods: historyPeriods("2026-11-19"), coverage: buildCoverage([]),
      failures: new Map(), failureLimit: 3, limit: 3, alreadyTonight: new Map([["f1", 3], ["f2", 1]]),
    });
    expect(picks.filter((p) => p.franchiseId === "f1")).toHaveLength(0);
    expect(picks.filter((p) => p.franchiseId === "f2")).toHaveLength(2);
  });
});
