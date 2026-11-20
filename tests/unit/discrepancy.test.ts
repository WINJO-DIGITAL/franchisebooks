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
    expect(NOT_COMPARED_TEXT.no_single_band).toMatch(/no rate for these stops and miles/);
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

import { routeRows } from "@/lib/finance/discrepancy";

describe("one check per route, never added together", () => {
  it("keeps each payment row as its own route, labelled with the driver and route", () => {
    const rows = routeRows([
      { franchiseId: "f1", date: "2026-11-02", driverName: "Alex Example", route: "564", stops: 100, mileage: 50, stopPayPence: 13900 },
      { franchiseId: "f1", date: "2026-11-02", driverName: "Blake Sample", route: "565", stops: 100, mileage: 50, stopPayPence: 13900 },
      { franchiseId: "f2", date: "2026-11-02", driverName: null, route: null, stops: 10, mileage: null, stopPayPence: 1000 },
    ]);
    expect(rows.get("f1")).toEqual([
      { date: "2026-11-02", label: "Alex Example · Route 564", stops: 100, miles: 50, stopPayPence: 13900 },
      { date: "2026-11-02", label: "Blake Sample · Route 565", stops: 100, miles: 50, stopPayPence: 13900 },
    ]);
    expect(rows.get("f2")).toEqual([{ date: "2026-11-02", stops: 10, miles: null, stopPayPence: 1000 }]);
  });
});

import { type ScaleGrid } from "@/lib/finance/scale-grid";

describe("the printed grid in the report", () => {
  const grid: ScaleGrid = { name: "Micro", stopRows: [60, 100, 200], mileCols: [10, 90, 160], values: [[1.5, 1.52, 1.55], [1.4, 1.41, 1.44], [1.3, 1.31, 1.33]] };

  it("checks each day against the grid, rounding stops and miles down", () => {
    // 104 stops, 91 miles: 100 row, 90 column = 1.41; 104 × 1.41 = £146.64 paid exactly → agrees.
    const report = buildDiscrepancyReport([{ date: "2026-11-11", stops: 104, miles: 91, stopPayPence: 14664 }], [], vehicle, grid);
    expect(report.totals.agreedDays).toBe(1);
  });

  it("keeps days above the printed scale out of the totals, with the guide rate shown", () => {
    const report = buildDiscrepancyReport([{ date: "2026-11-12", stops: 230, miles: 20, stopPayPence: 30000 }], [], vehicle, grid);
    expect(report.totals).toMatchObject({ comparedDays: 0, notComparedDays: 1, underpaidPence: 0, overpaidPence: 0 });
    const day = report.days[0]!;
    expect(day).toMatchObject({ kind: "not_compared", reason: "beyond_scale", guideRate: 1.3 });
    expect(NOT_COMPARED_TEXT.beyond_scale).toMatch(/guide only/);
  });
});

describe("checks found when verifying against the printed Micro scale", () => {
  // Rows 95, 100, 200 and columns 50, 80, 90, 100, 160 of the printed scale.
  const micro: ScaleGrid = {
    name: "Electric Vehicle Sliding Scale - Micro",
    stopRows: [95, 100, 200],
    mileCols: [50, 80, 90, 100, 160],
    values: [[1.41, 1.42, 1.43, 1.43, 1.46], [1.39, 1.4, 1.41, 1.41, 1.44], [1.26, 1.27, 1.27, 1.27, 1.28]],
  };

  it("does not flag two drivers who were each paid correctly on the same day", () => {
    const rows = routeRows([
      { franchiseId: "f", date: "2026-11-03", driverName: "A", route: "1", stops: 100, mileage: 50, stopPayPence: 13900 },
      { franchiseId: "f", date: "2026-11-03", driverName: "B", route: "2", stops: 100, mileage: 50, stopPayPence: 13900 },
    ]).get("f")!;
    const report = buildDiscrepancyReport(rows, [], vehicle, micro);
    expect(report.totals).toMatchObject({ agreedDays: 2, underpaidDays: 0, overpaidDays: 0, netPence: 0 });
  });

  it("catches a route paid 1p a stop short (the wrong column), which a 2p tolerance would hide", () => {
    // 104 stops, 91 miles: the 100 row and 90 column = £1.41. Paid at the 80 column instead: £1.40, 1p a stop short.
    const report = buildDiscrepancyReport([{ date: "2026-11-04", stops: 104, miles: 91, stopPayPence: 140 * 104 }], [], vehicle, micro);
    expect(report.days[0]).toMatchObject({ kind: "underpaid", differencePence: -104 });
  });

  it("agrees only when the pay is exactly stops × the printed rate", () => {
    const exact = buildDiscrepancyReport([{ date: "2026-11-05", stops: 104, miles: 91, stopPayPence: 14664 }], [], vehicle, micro);
    expect(exact.days[0]!.kind).toBe("agrees");
    const onePennyOver = buildDiscrepancyReport([{ date: "2026-11-05", stops: 104, miles: 91, stopPayPence: 14665 }], [], vehicle, micro);
    expect(onePennyOver.days[0]).toMatchObject({ kind: "overpaid", differencePence: 1 });
  });

  it("does not compare a route with no miles stated against a scale that needs them", () => {
    const report = buildDiscrepancyReport([{ date: "2026-11-06", stops: 104, miles: null, stopPayPence: 14664 }], [], vehicle, micro);
    expect(report.days[0]).toMatchObject({ kind: "not_compared", reason: "no_single_band" });
  });
});

