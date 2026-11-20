import { describe, expect, it } from "vitest";
import { buildDiscrepancyReport, NOT_COMPARED_TEXT, TOLERANCE_PER_STOP } from "@/lib/finance/discrepancy";
import type { ScaleBand, VehicleSpec } from "@/lib/finance/sliding-scale";

const vehicle: VehicleSpec = { vehicleType: "van", vehicleSize: null, fuelType: "diesel" };
const band = (stopsFrom: number, stopsTo: number | null, rate: number, milesFrom: number | null = null, milesTo: number | null = null): ScaleBand =>
  ({ vehicleType: "van", vehicleSize: null, fuelType: "diesel", stopsFrom, stopsTo, milesFrom, milesTo, rate });
const bands = [band(0, 100, 1.0), band(101, null, 1.1)];

describe("sliding-scale discrepancy report", () => {
  it("lists underpayments and overpayments in both directions, with the money for each day", () => {
    const report = buildDiscrepancyReport([
      { date: "2026-11-02", stops: 80, miles: null, stopPayPence: 7000 },  // scale 1.00 × 80 = 8000 → underpaid 1000p
      { date: "2026-11-03", stops: 80, miles: null, stopPayPence: 8000 },  // agrees
      { date: "2026-11-04", stops: 50, miles: null, stopPayPence: 5600 },  // scale 5000 → overpaid 600p
    ], bands, vehicle);
    expect(report.totals).toMatchObject({ comparedDays: 3, agreedDays: 1, underpaidDays: 1, overpaidDays: 1, notComparedDays: 0, underpaidPence: -1000, overpaidPence: 600, netPence: -400 });
    expect(report.ordered.map((o) => `${o.kind}:${o.date}`)).toEqual(["underpaid:2026-11-02", "overpaid:2026-11-04", "agrees:2026-11-03"]);
  });

  it("never counts a day it cannot compare as agreeing or differing, and gives the reason", () => {
    const report = buildDiscrepancyReport([
      { date: "2026-11-05", stops: null, miles: null, stopPayPence: 8000 },
      { date: "2026-11-06", stops: 80, miles: null, stopPayPence: null },
      { date: "2026-11-07", stops: 80, miles: null, stopPayPence: 8000 },
    ], [band(0, 40, 1.0)], vehicle);
    expect(report.totals.notComparedDays).toBe(3);
    expect(report.totals.comparedDays).toBe(0);
    const reasons = report.days.filter((d) => d.kind === "not_compared").map((d) => (d.kind === "not_compared" ? d.reason : ""));
    expect(reasons).toEqual(["no_stops", "no_stop_pay", "no_single_band"]);
    expect(NOT_COMPARED_TEXT.no_single_band).toMatch(/No single band/);
  });

  it("needs miles where the scale has mileage limits, and does not guess without them", () => {
    const withMiles = [band(0, null, 1.0, 0, 50), band(0, null, 1.2, 51, null)];
    const withoutMiles = buildDiscrepancyReport([{ date: "2026-11-08", stops: 60, miles: null, stopPayPence: 6000 }], withMiles, vehicle);
    expect(withoutMiles.totals.notComparedDays).toBe(1);
    const withMilesFigure = buildDiscrepancyReport([{ date: "2026-11-08", stops: 60, miles: 40, stopPayPence: 6000 }], withMiles, vehicle);
    expect(withMilesFigure.totals.agreedDays).toBe(1);
  });

  it("treats a difference within the tolerance as agreeing", () => {
    const within = (TOLERANCE_PER_STOP * 100 - 1) / 100; // just inside the tolerance, in pounds per stop
    const report = buildDiscrepancyReport([{ date: "2026-11-09", stops: 100, miles: null, stopPayPence: Math.round((1.0 + within) * 100 * 100) }], [band(0, 100, 1.0)], vehicle);
    expect(report.totals.agreedDays).toBe(1);
  });

  it("gives a clean report when every day agrees, and totals of zero when there are no days", () => {
    const agree = buildDiscrepancyReport([{ date: "2026-11-10", stops: 10, miles: null, stopPayPence: 1000 }], [band(0, 100, 1.0)], vehicle);
    expect(agree.totals).toMatchObject({ comparedDays: 1, agreedDays: 1, underpaidDays: 0, overpaidDays: 0, netPence: 0 });
    const empty = buildDiscrepancyReport([], [band(0, 100, 1.0)], vehicle);
    expect(empty.totals).toMatchObject({ comparedDays: 0, netPence: 0 });
  });

  it("gives the same answer however the days were ordered on the way in", () => {
    const a = buildDiscrepancyReport([{ date: "2026-11-02", stops: 80, miles: null, stopPayPence: 7000 }, { date: "2026-11-04", stops: 50, miles: null, stopPayPence: 5600 }], bands, vehicle);
    const b = buildDiscrepancyReport([{ date: "2026-11-04", stops: 50, miles: null, stopPayPence: 5600 }, { date: "2026-11-02", stops: 80, miles: null, stopPayPence: 7000 }], bands, vehicle);
    expect(a.totals).toEqual(b.totals);
    expect(a.ordered).toEqual(b.ordered);
  });
});

import { dailyFromRows } from "@/lib/finance/discrepancy";

describe("adding up a day across drivers", () => {
  it("adds stops, miles and stop pay for each franchise and day", () => {
    const days = dailyFromRows([
      { franchiseId: "f1", date: "2026-11-02", stops: 40, mileage: 30, stopPayPence: 4000 },
      { franchiseId: "f1", date: "2026-11-02", stops: 40, mileage: 25, stopPayPence: 4000 },
      { franchiseId: "f2", date: "2026-11-02", stops: 10, mileage: null, stopPayPence: 1000 },
    ]);
    expect(days.get("f1")).toEqual([{ date: "2026-11-02", stops: 80, miles: 55, stopPayPence: 8000 }]);
    expect(days.get("f2")).toEqual([{ date: "2026-11-02", stops: 10, miles: null, stopPayPence: 1000 }]);
  });

  it("leaves a total blank when any driver's row does not state it", () => {
    const [day] = dailyFromRows([
      { franchiseId: "f1", date: "2026-11-03", stops: 40, mileage: null, stopPayPence: 4000 },
      { franchiseId: "f1", date: "2026-11-03", stops: 40, mileage: 20, stopPayPence: null },
    ]).get("f1")!;
    expect(day).toEqual({ date: "2026-11-03", stops: 80, miles: null, stopPayPence: null });
  });
});
