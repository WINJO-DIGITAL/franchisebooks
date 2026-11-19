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

describe("sustained drops in stops", () => {
  /** Mon-Sat history ending 13/11/2026; the last `week` days (the 7 days to the 13th) use `weekStops`. */
  function rows(baseStops: number, weekStops: number): AnomalyEarning[] {
    return history("d1", "2026-11-14", 40, { stops: baseStops }).map((r) => (r.date >= "2026-11-07" ? { ...r, stops: weekStops } : r));
  }

  it("stays quiet for normal variation and for a single bad day", () => {
    const base = history("d1", "2026-11-13", 40);
    expect(run({ earnings: [...base, earning({ date: "2026-11-13", stops: 92 })] }).filter((a) => a.driverId === "d1")).toEqual([]);
    expect(run({ earnings: [...base, earning({ date: "2026-11-13", stops: 50, gross: 6000, parcels: 60 })] }).filter((a) => a.driverId === "d1")).toEqual([]);
  });

  it("never alerts when figures are ABOVE usual: more work is not a problem", () => {
    const more = rows(100, 200).map((r) => (r.date >= "2026-11-07" ? { ...r, gross: 24000 } : r));
    expect(run({ earnings: more })).toEqual([]);
  });

  it("flags stops down across the week, with a plain explanation and no judgement of the driver", () => {
    const found = run({ earnings: rows(100, 70) }).find((a) => a.type === "sustained_drop")!;
    expect(found).toBeDefined();
    expect(found.severity).toBe("attention");
    expect(found.title).toContain("30%");
    expect(found.expectedValue).toBe("100 stops a day");
    expect(found.actualValue).toBe("70 stops a day");
    expect(found.whyFlagged).toContain("Sundays with Sundays");
    expect(`${found.title} ${found.whatHappened}`.toLowerCase()).not.toMatch(/underperform|poor|lazy|bad/);
  });

  it("treats a very large drop as urgent", () => {
    expect(run({ earnings: rows(100, 50) }).find((a) => a.type === "sustained_drop")?.severity).toBe("urgent");
  });

  it("compares like days with like: a normally quiet Sunday is not a drop", () => {
    const base: AnomalyEarning[] = [];
    for (let d = "2026-10-10"; d <= "2026-11-13"; d = addDays(d, 1)) base.push(earning({ date: d, stops: weekdayOf(d) === 0 ? 40 : 100 }));
    expect(run({ earnings: base })).toEqual([]);
  });

  it("makes no comparison without enough history", () => {
    expect(run({ earnings: [...history("d1", "2026-11-13", 4), earning({ date: "2026-11-13", stops: 10 })] })).toEqual([]);
  });

  it("produces stable keys so the same alert is never raised twice", () => {
    const a = run({ earnings: rows(100, 70) }).map((x) => x.dedupeKey).sort();
    const b = run({ earnings: rows(100, 70) }).map((x) => x.dedupeKey).sort();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it("notices a changed pay rate and an unusual DPD deduction", () => {
    const earnings = [...history("d1", "2026-11-13", 20), earning({ date: "2026-11-13", payPerStop: "0.5500", deductions: 4000 })];
    const types = run({ earnings }).map((a) => a.type);
    expect(types).toContain("pay_rate_changed");
    expect(types).toContain("dpd_deduction_unusual");
  });
});

describe("income per stop, charges and invoices", () => {
  const charge = (o: Partial<AnomalyCost>): AnomalyCost => ({
    id: `x${++seq}`, kind: "expense", isFuel: false, franchiseId: F, driverId: null, date: "2026-11-09", amount: 10000, categoryId: "c",
    categoryName: "DPD charges", supplier: null, vehicleRegistration: null, reference: null, ...o,
  });

  it("flags income per stop falling across a franchise, not just a driver", () => {
    const earnings = history("d1", "2026-11-14", 40, { stops: 100, gross: 12000 }).map((r) => (r.date >= "2026-11-07" ? { ...r, gross: 10000 } : r));
    const found = run({ earnings }).find((a) => a.type === "yield_low")!;
    expect(found.title).toContain("income per stop down");
    expect(found.driverId).toBeNull();
  });

  it("flags DPD charges rising on the previous period, and ignores a small change", () => {
    const over = run({ evalFrom: "2026-11-09", costs: [charge({ date: "2026-10-12", amount: 10000 }), charge({ date: "2026-11-09", amount: 13000 })] });
    expect(over.find((a) => a.type === "charges_spike")?.title).toContain("30%");
    const small = run({ evalFrom: "2026-11-09", costs: [charge({ date: "2026-10-12", amount: 10000 }), charge({ date: "2026-11-09", amount: 10500 })] });
    expect(small.some((a) => a.type === "charges_spike")).toBe(false);
  });

  it("does not treat DPD's own repeated charges as duplicates", () => {
    const costs = [charge({ fromDpd: true, date: "2026-11-13" }), charge({ fromDpd: true, date: "2026-11-13" })];
    expect(run({ costs }).some((a) => a.type === "duplicate_cost")).toBe(false);
    expect(run({ costs: costs.map((c) => ({ ...c, fromDpd: false })) }).some((a) => a.type === "duplicate_cost")).toBe(true);
  });

  const invoice = (o: object) => ({ id: "inv1", franchiseId: F, invoiceNo: "FI100", periodStart: "2026-11-09", periodEnd: "2026-11-10", reconciled: true, stopPayNet: 24000, storedOn: "2026-11-13", ...o });
  const paid = [earning({ date: "2026-11-09", gross: 12000 }), earning({ date: "2026-11-10", gross: 12000 })];

  it("stays quiet when an invoice matches the daily payments", () => {
    expect(run({ earnings: paid, invoices: [invoice({})] }).some((a) => a.type.startsWith("invoice_"))).toBe(false);
  });

  it("flags an invoice that differs from the daily payments by more than the tolerance", () => {
    const found = run({ earnings: paid, invoices: [invoice({ stopPayNet: 29000 })] }).find((a) => a.type === "invoice_mismatch")!;
    expect(found.actualValue).toBe("£240.00");
    expect(found.expectedValue).toBe("£290.00");
  });

  it("ignores an old invoice that is only now being stored", () => {
    const old = invoice({ stopPayNet: 29000, periodStart: "2025-01-06", periodEnd: "2025-02-02" });
    expect(run({ earnings: paid, invoices: [old] }).some((a) => a.type.startsWith("invoice_"))).toBe(false);
  });

  it("does not compare an invoice with daily payments we never read: no data is not the same as nothing earned", () => {
    // The invoice says £6,000 for a period before the first day we hold; the daily total there is £0 only because it was never read.
    const early = invoice({ periodStart: "2026-10-12", periodEnd: "2026-11-08", stopPayNet: 600000 });
    const coverage = { [F]: { first: "2026-11-09", last: "2026-11-10" } };
    expect(run({ earnings: paid, invoices: [early], dailyCoverage: coverage }).some((a) => a.type.startsWith("invoice_"))).toBe(false);
  });

  it("still compares an invoice when the daily payments cover its whole period", () => {
    const coverage = { [F]: { first: "2026-11-09", last: "2026-11-10" } };
    expect(run({ earnings: paid, invoices: [invoice({ stopPayNet: 29000 })], dailyCoverage: coverage }).some((a) => a.type === "invoice_mismatch")).toBe(true);
    expect(run({ earnings: paid, invoices: [invoice({})], dailyCoverage: coverage }).some((a) => a.type.startsWith("invoice_"))).toBe(false);
  });

  it("flags an invoice that could not be read reliably", () => {
    expect(run({ earnings: paid, invoices: [invoice({ reconciled: false })] }).some((a) => a.type === "invoice_unreadable")).toBe(true);
  });

  it("flags costs left unassigned for over a week, once per franchise", () => {
    const found = run({ costs: [charge({ date: "2026-11-02", unassigned: true, fromDpd: false }), charge({ date: "2026-11-03", amount: 5000, unassigned: true, fromDpd: false })] }).filter((a) => a.type === "cost_unassigned");
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toContain("2 costs");
  });
});

describe("absences and missing days are not alerts", () => {
  it("does not flag a franchise with no report on a day, or a driver missing from a day", () => {
    const rows = [...history("d1", "2026-11-13", 24), ...history("d2", "2026-11-14", 24)];
    const types = run({ earnings: rows }).map((a) => a.type);
    expect(types).not.toContain("missing_franchise_report");
    expect(types).not.toContain("missing_driver_report");
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
