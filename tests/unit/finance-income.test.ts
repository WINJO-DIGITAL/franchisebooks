import { describe, expect, it } from "vitest";
import { summarisePeriod, type CostRow, type EarningRow, type PeriodInput } from "@/lib/finance/calc";
import type { DayRate } from "@/lib/finance/wages";

const F1 = "f1";
const F2 = "f2";
const names = new Map([["d1", "Alex Example"], ["d2", "Blake Sample"]]);

let seq = 0;
const earning = (o: Partial<EarningRow>): EarningRow => ({
  id: `e${++seq}`, franchiseId: F1, driverId: "d1", driverKey: "alex", sourceDriverName: "Alex Example",
  date: "2026-11-02", parcels: 100, stops: 80, gross: 20000, deductions: 0, additional: 0, netSupplied: null, ...o,
});
const cost = (o: Partial<CostRow>): CostRow => ({
  id: `c${++seq}`, kind: "expense", franchiseId: F1, date: "2026-11-09", amount: 9000, categoryId: "cat", categoryName: "DPD charges",
  categoryKind: "other", allocation: { scope: "franchise" }, ...o,
});
const base = (o: Partial<PeriodInput>): PeriodInput => ({
  from: "2026-11-01", to: "2026-11-30", earnings: [], adjustments: [], costs: [], covers: [], revenue: [],
  driverNames: names, revenueAllocationBasis: "none", earningsMeaning: "route_income", dayRates: [], ...o,
});
const rate = (driverId: string, dayRate: number, effectiveFrom = "2026-10-01"): DayRate => ({ driverId, dayRate, effectiveFrom });

describe("route income mode", () => {
  it("counts imported DPD payments as income, wages from day rates, and profit = income − wages − charges", () => {
    const summary = summarisePeriod(base({
      earnings: [earning({ date: "2026-11-02" }), earning({ date: "2026-11-03", gross: 25000 })],
      costs: [cost({})],
      dayRates: [rate("d1", 12000)],
    })).combined;
    expect(summary.incomeFromDpd).toBe(45000);
    expect(summary.revenueTotal).toBe(45000);
    expect(summary.revenueStatus).toBe("confirmed");
    expect(summary.wages).toBe(24000); // 2 days × £120
    expect(summary.wagesComplete).toBe(true);
    expect(summary.operatingCosts).toBe(24000 + 9000);
    expect(summary.operatingProfit).toBe(45000 - 24000 - 9000);
    expect(summary.profitBeforeWages).toBe(45000 - 9000);
    expect(summary.marginPercent).toBe(26.7);
  });

  it("does not guess profit when a worked day has no day rate: wages are incomplete, profit is unavailable", () => {
    const summary = summarisePeriod(base({
      earnings: [earning({ date: "2026-11-02" }), earning({ driverId: "d2", driverKey: "blake", sourceDriverName: "Blake Sample", date: "2026-11-02" })],
      dayRates: [rate("d1", 12000)],
    })).combined;
    expect(summary.driversMissingRate).toBe(1);
    expect(summary.wagesComplete).toBe(false);
    expect(summary.operatingProfit).toBeNull();
    expect(summary.profitStatus).toBe("unavailable");
    expect(summary.profitBeforeWages).toBe(40000); // income is still known
    const blake = summary.drivers.find((d) => d.driverId === "d2")!;
    expect(blake.wage).toBe(0); // only the days with a rate are counted, and it is flagged incomplete
    expect(blake.wageComplete).toBe(false);
    expect(blake.contribution).toBeNull();
  });

  it("gives each driver their income, wage and contribution", () => {
    const summary = summarisePeriod(base({ earnings: [earning({ date: "2026-11-02" })], dayRates: [rate("d1", 12000)] })).combined;
    const alex = summary.drivers[0]!;
    expect(alex.originalEarnings).toBe(20000);
    expect(alex.wage).toBe(12000);
    expect(alex.contribution).toBe(8000);
    expect(alex.contributionStatus).toBe("confirmed");
  });

  it("uses the rate in force on each day, so a rate change does not rewrite earlier days", () => {
    const summary = summarisePeriod(base({
      earnings: [earning({ date: "2026-11-02" }), earning({ date: "2026-11-12" })],
      dayRates: [rate("d1", 12000, "2026-10-01"), rate("d1", 15000, "2026-11-10")],
    })).combined;
    expect(summary.wages).toBe(12000 + 15000);
  });

  it("combined profit is unavailable if any franchise's wages are incomplete", () => {
    const summary = summarisePeriod(base({
      earnings: [earning({ date: "2026-11-02" }), earning({ franchiseId: F2, driverId: "d2", driverKey: "blake", sourceDriverName: "Blake Sample" })],
      dayRates: [rate("d1", 12000)],
    }));
    expect(summary.franchises.find((f) => f.franchiseId === F1)!.operatingProfit).toBe(8000);
    expect(summary.franchises.find((f) => f.franchiseId === F2)!.operatingProfit).toBeNull();
    expect(summary.combined.operatingProfit).toBeNull();
  });
});

describe("driver pay mode (the original behaviour)", () => {
  it("is unchanged: earnings are a cost and revenue is only what was entered", () => {
    const summary = summarisePeriod(base({ earningsMeaning: "driver_pay", earnings: [earning({})], revenue: [] })).combined;
    expect(summary.incomeFromDpd).toBe(0);
    expect(summary.revenueStatus).toBe("unavailable");
    expect(summary.driverCosts).toBe(20000);
    expect(summary.wages).toBe(20000);
    expect(summary.wagesComplete).toBe(true);
    expect(summary.operatingProfit).toBeNull();
  });
});
