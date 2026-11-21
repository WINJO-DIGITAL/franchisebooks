import { describe, expect, it } from "vitest";
import { wagesLinesFrom, type DriverPayLine } from "@/lib/reports/end-of-period";

/** A driver's line as the Driver Pay Report builds it: one per person, across all their franchises. */
const line = (over: { driverId?: string; name?: string; franchiseCount?: number; total?: number; unpriced?: number }): DriverPayLine => ({
  driverId: over.driverId ?? "d1",
  name: over.name ?? "Jamie Townsend",
  franchiseLabel: "FD42102",
  franchiseCount: over.franchiseCount ?? 1,
  rateText: "£120.00 a day",
  base: 0,
  extra: 0,
  runDays: 0,
  statement: { total: over.total ?? 0, unpricedDates: Array.from({ length: over.unpriced ?? 0 }, (_, i) => `2026-11-${10 + i}`) } as unknown as DriverPayLine["statement"],
} as DriverPayLine);

describe("wagesLinesFrom", () => {
  it("gives one line per driver with their DR number and how many FD numbers they worked under", () => {
    const [w] = wagesLinesFrom([line({ franchiseCount: 3, total: 293_400 })], new Map([["d1", "DR66445"]]));
    expect(w).toMatchObject({ dr: "DR66445", franchises: 3, total: 293_400, complete: true });
  });

  it("marks a driver with unpriced days as incomplete, and keeps the amount for the days that were priced", () => {
    const [w] = wagesLinesFrom([line({ total: 0, unpriced: 5 })], new Map());
    expect(w).toMatchObject({ total: 0, complete: false, dr: null });
  });
});
