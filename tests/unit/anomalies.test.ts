import { describe, expect, it } from "vitest";
import {
  baselineOf, classifyStops, DEFAULT_ANOMALY_CONFIG, detectAnomalies, resolveAnomalyConfig,
  type AnomalyCost, type AnomalyEarning, type AnomalyInput,
} from "@/lib/anomalies/detect";
import { addDays, weekdayOf } from "@/lib/dates";

const F = "f1";
const franchises = [{ id: F, fdNumber: "FD-TEST-1", name: "Synthetic North" }];
const drivers = [
  { id: "d1", name: "Alex Example", isActive: true, startDate: null, leavingDate: null },
  { id: "d2", name: "Blake Sample", isActive: true, startDate: null, leavingDate: null },
];
const assignments = [
  { driverId: "d1", franchiseId: F, startDate: "2026-01-01", endDate: null },
  { driverId: "d2", franchiseId: F, startDate: "2026-01-01", endDate: null },
];

let seq = 0;
function earning(o: Partial<AnomalyEarning>): AnomalyEarning {
  return {
    id: `e${++seq}`, franchiseId: F, driverId: "d1", driverKey: "d1", sourceDriverName: "Alex Example", date: "2026-11-02",
    parcels: 120, stops: 100, gross: 12000, deductions: 0, additional: 0, netSupplied: null,
    payPerParcel: "0.5000", payPerStop: "0.6000", ...o,
  };
}

/** Monday–Saturday history ending the day before `until`. */
function history(driverId: string, until: string, days: number, o: Partial<AnomalyEarning> = {}): AnomalyEarning[] {
  const rows: AnomalyEarning[] = [];
  for (let d = addDays(until, -1); rows.length < days; d = addDays(d, -1)) {
    if (weekdayOf(d) === 0) continue;
    rows.push(earning({ driverId, driverKey: driverId, sourceDriverName: driverId, date: d, ...o }));
  }
  return rows;
}

function run(o: Partial<AnomalyInput>) {
  return detectAnomalies({
    evalFrom: "2026-11-13", evalTo: "2026-11-13", reportsExpectedThrough: "2026-11-13", config: DEFAULT_ANOMALY_CONFIG,
    franchises, drivers, assignments, earnings: [], costs: [], covers: [], openConflicts: [], ...o,
  });
}

describe("baseline", () => {
  it("needs a minimum amount of history", () => {
    expect(baselineOf([100, 100, 100], 25, 5)).toBeNull();
    expect(baselineOf([100, 100, 100, 100, 100], 25, 5)).toMatchObject({ mean: 100, low: 75, high: 125, n: 5 });
  });
  it("widens the usual range for drivers whose figures naturally vary", () => {
    const b = baselineOf([60, 140, 60, 140, 60, 140], 25, 5)!;
    expect(b.mean).toBe(100);
    expect(b.low).toBeLessThan(75);
    expect(b.high).toBeGreaterThan(125);
  });
});

describe("stop consistency", () => {
  const baseline = baselineOf([100, 102, 98, 101, 99, 100], 25, 5);
  it("distinguishes normal, unusual, missing and discrepancy", () => {
    expect(classifyStops(96, baseline)).toBe("normal");
    expect(classifyStops(60, baseline)).toBe("unusual");
    expect(classifyStops(null, baseline)).toBe("missing");
    expect(classifyStops(100, null)).toBe("no_history");
    expect(classifyStops(100, baseline, { hasSourceConflict: true })).toBe("discrepancy");
  });
});

describe("earnings, stops and parcels", () => {
  it("stays quiet for normal day-to-day variation", () => {
    const rows = [...history("d1", "2026-11-13", 20), earning({ date: "2026-11-13", gross: 11000, stops: 92, parcels: 110 })];
    expect(run({ earnings: rows }).filter((a) => a.driverId === "d1")).toEqual([]);
  });

  it("flags a large drop with a full explanation and no judgement of the driver", () => {
    const rows = [...history("d1", "2026-11-13", 20), earning({ date: "2026-11-13", gross: 6000, stops: 50, parcels: 60 })];
    const found = run({ earnings: rows });
    const low = found.find((a) => a.type === "earnings_low")!;
    expect(low).toBeDefined();
    expect(low.actualValue).toBe("£60.00");
    expect(low.expectedValue).toContain("£120.00");
    expect(low.whyFlagged).toContain("50% below");
    expect(low.whyFlagged).toContain("previous 20 working days");
    expect(low.suggestedAction.length).toBeGreaterThan(10);
    expect(low.severity).toBe("urgent");
    expect(found.some((a) => a.type === "stops_low")).toBe(true);
    expect(found.some((a) => a.type === "parcels_low")).toBe(true);
    for (const a of found) expect(`${a.title} ${a.whatHappened}`.toLowerCase()).not.toMatch(/underperform|poor|lazy|bad/);
  });

  it("flags unexpectedly high payments too", () => {
    const rows = [...history("d1", "2026-11-13", 20), earning({ date: "2026-11-13", gross: 20000 })];
    expect(run({ earnings: rows }).map((a) => a.type)).toContain("earnings_high");
  });

  it("makes no comparison without enough history", () => {
    const rows = [...history("d1", "2026-11-13", 3), earning({ date: "2026-11-13", gross: 2000, stops: 10, parcels: 10 })];
    expect(run({ earnings: rows })).toEqual([]);
  });

  it("respects configurable thresholds", () => {
    const rows = [...history("d1", "2026-11-13", 20), earning({ date: "2026-11-13", gross: 9600, stops: 100, parcels: 120 })];
    expect(run({ earnings: rows }).some((a) => a.type === "earnings_low")).toBe(false);
    const strict = resolveAnomalyConfig({ earningsChangePct: 10, earningsMinDiffPence: 500 });
    expect(run({ earnings: rows, config: strict }).some((a) => a.type === "earnings_low")).toBe(true);
  });

  it("produces stable keys so the same alert is never raised twice", () => {
    const rows = [...history("d1", "2026-11-13", 20), earning({ date: "2026-11-13", gross: 6000 })];
    const a = run({ earnings: rows }).map((x) => x.dedupeKey).sort();
    const b = run({ earnings: rows }).map((x) => x.dedupeKey).sort();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("notices a changed pay rate and an unusual DPD deduction", () => {
    const rows = [
      ...history("d1", "2026-11-13", 20),
      earning({ date: "2026-11-13", payPerStop: "0.5500", deductions: 4000 }),
    ];
    const types = run({ earnings: rows }).map((a) => a.type);
    expect(types).toContain("pay_rate_changed");
    expect(types).toContain("dpd_deduction_unusual");
  });

  it("flags an erratic stop pattern as information only", () => {
    const rows: AnomalyEarning[] = history("d1", "2026-11-14", 12).map((r, i) => ({ ...r, stops: i % 2 ? 40 : 130 }));
    const found = run({ earnings: rows }).find((a) => a.type === "stops_inconsistent");
    expect(found?.severity).toBe("info");
  });
});

describe("missing reports and unregistered drivers", () => {
  it("flags a franchise with no report on a day it normally has one", () => {
    const rows = history("d1", "2026-11-13", 24);
    const found = run({ earnings: rows }).find((a) => a.type === "missing_franchise_report")!;
    expect(found.subjectDate).toBe("2026-11-13");
    expect(found.severity).toBe("urgent");
  });

  it("does not expect a report on a day the franchise does not normally work", () => {
    const rows = history("d1", "2026-11-15", 24);
    expect(run({ earnings: rows, evalFrom: "2026-11-15", evalTo: "2026-11-15", reportsExpectedThrough: "2026-11-15" })).toEqual([]);
  });

  it("does not flag a report that is not due yet", () => {
    const rows = history("d1", "2026-11-13", 24);
    expect(run({ earnings: rows, reportsExpectedThrough: "2026-11-12" })).toEqual([]);
  });

  it("flags a regular driver missing from a report that did arrive", () => {
    const rows = [...history("d1", "2026-11-13", 24), ...history("d2", "2026-11-14", 24)];
    const found = run({ earnings: rows }).filter((a) => a.type === "missing_driver_report");
    expect(found).toHaveLength(1);
    expect(found[0]!.driverId).toBe("d1");
  });

  it("treats a recorded cover as the explanation for an absence", () => {
    const rows = [...history("d1", "2026-11-13", 24), ...history("d2", "2026-11-14", 24)];
    const covers = [{ id: "c1", franchiseId: F, date: "2026-11-13", originalDriverId: "d1", coveringDriverId: "d2", expenseAttribution: "original" as const, status: "active" as const }];
    expect(run({ earnings: rows, covers }).filter((a) => a.type === "missing_driver_report")).toEqual([]);
  });

  it("does not expect a driver who has left", () => {
    const rows = [...history("d1", "2026-11-13", 24), ...history("d2", "2026-11-14", 24)];
    const left = drivers.map((d) => (d.id === "d1" ? { ...d, leavingDate: "2026-11-12" } : d));
    expect(run({ earnings: rows, drivers: left }).filter((a) => a.type === "missing_driver_report")).toEqual([]);
  });

  it("flags report names that match no registered driver, once", () => {
    const rows = [
      earning({ driverId: null, driverKey: "new person", sourceDriverName: "New Person", date: "2026-11-12" }),
      earning({ driverId: null, driverKey: "new person", sourceDriverName: "New Person", date: "2026-11-13" }),
    ];
    const found = run({ earnings: rows }).filter((a) => a.type === "unregistered_driver");
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toContain("New Person");
  });
});

describe("fuel and expenses", () => {
  let n = 0;
  const cost = (o: Partial<AnomalyCost>): AnomalyCost => ({
    id: `c${++n}`, kind: "fuel", isFuel: true, franchiseId: F, driverId: null, date: "2026-11-02", amount: 6000, categoryId: null,
    categoryName: "Fuel", supplier: "Synthetic Fuels", vehicleRegistration: "AB12CDE", reference: null, ...o,
  });
  const weeklyFuel = (amounts: number[], lastWeekStart: string) =>
    amounts.map((amount, i) => cost({ date: addDays(lastWeekStart, -7 * (amounts.length - 1 - i)), amount, reference: `r${i}` }));

  it("flags a week of unusually high fuel spend", () => {
    const costs = weeklyFuel([10000, 10500, 9800, 10200, 18000], "2026-11-02");
    const found = run({ costs, evalFrom: "2026-11-02", evalTo: "2026-11-08", reportsExpectedThrough: "2026-11-08" }).filter((a) => a.type === "fuel_high");
    expect(found).toHaveLength(1);
    expect(found[0]!.actualValue).toBe("£180.00");
  });

  it("does not judge a week that has not finished", () => {
    const costs = weeklyFuel([10000, 10500, 9800, 10200, 18000], "2026-11-02");
    expect(run({ costs, evalFrom: "2026-11-02", evalTo: "2026-11-05", reportsExpectedThrough: "2026-11-05" }).filter((a) => a.type === "fuel_high")).toEqual([]);
  });

  it("flags possible duplicates without removing anything", () => {
    const costs = [cost({ date: "2026-11-13", amount: 7550, reference: "A1" }), cost({ date: "2026-11-13", amount: 7550, reference: "A2" })];
    const found = run({ costs }).filter((a) => a.type === "duplicate_cost");
    expect(found).toHaveLength(1);
    expect(found[0]!.metric.ids).toHaveLength(2);
  });

  it("flags an expense far above what is typical for its category", () => {
    const base = { kind: "expense" as const, isFuel: false, categoryId: "tyres", categoryName: "Tyres", vehicleRegistration: null };
    const costs = [
      ...[9000, 11000, 10000, 12000].map((amount, i) => cost({ ...base, amount, date: addDays("2026-08-01", i * 20), supplier: `S${i}` })),
      cost({ ...base, amount: 48000, date: "2026-11-13", supplier: "Big Bill Ltd" }),
    ];
    const found = run({ costs }).filter((a) => a.type === "expense_high");
    expect(found).toHaveLength(1);
    expect(found[0]!.expectedValue).toContain("£105.00");
  });

  it("flags a week with no fuel data for a franchise that normally has it", () => {
    const earnings = history("d1", "2026-11-09", 36);
    const costs = weeklyFuel([10000, 10000, 10000, 10000], "2026-10-26");
    const found = run({ earnings, costs, evalFrom: "2026-11-02", evalTo: "2026-11-08", reportsExpectedThrough: "2026-11-10" })
      .filter((a) => a.type === "missing_fuel");
    expect(found).toHaveLength(1);
  });
});

describe("source conflicts", () => {
  it("surfaces documents that disagree", () => {
    const found = run({ openConflicts: [{ id: "r1", franchiseId: F, title: "Two documents disagree", detail: "…", date: "2026-11-13" }] });
    expect(found[0]).toMatchObject({ type: "source_conflict", severity: "urgent" });
  });
});
