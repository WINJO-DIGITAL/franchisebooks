import { describe, expect, it } from "vitest";
import {
  adjustedPay, buildDriverDays, combineFranchises, comparePerformance, effectiveAllocation, netDiscrepancy, originalEarnings,
  summarisePeriod, totalAdjustments,
  type AdjustmentRow, type CostRow, type CoverRow, type EarningRow, type PeriodInput, type RevenueRow,
} from "@/lib/finance/calc";
import { sumPence } from "@/lib/money";

const F1 = "f1";
const F2 = "f2";
const names = new Map([["d1", "Alex Example"], ["d2", "Blake Sample"], ["d3", "Casey Test"]]);

let seq = 0;
const earning = (o: Partial<EarningRow>): EarningRow => ({
  id: `e${++seq}`, franchiseId: F1, driverId: "d1", driverKey: "alex example", sourceDriverName: "Alex Example",
  date: "2026-11-02", parcels: 100, stops: 80, gross: 12000, deductions: 0, additional: 0, netSupplied: null, ...o,
});
const adj = (o: Partial<AdjustmentRow>): AdjustmentRow => ({
  id: `a${++seq}`, franchiseId: F1, driverId: "d1", date: "2026-11-02", type: "additional_payment", amount: 5000,
  reversesId: null, coverRecordId: null, ...o,
});
const cost = (o: Partial<CostRow>): CostRow => ({
  id: `c${++seq}`, kind: "fuel", franchiseId: F1, date: "2026-11-02", amount: 6000, categoryId: null, categoryName: "Fuel",
  categoryKind: "fuel", allocation: { scope: "unallocated" }, ...o,
});
const rev = (o: Partial<RevenueRow>): RevenueRow => ({
  id: `r${++seq}`, franchiseId: F1, periodStart: "2026-11-01", periodEnd: "2026-11-30", amount: 500000, status: "confirmed", ...o,
});
const input = (o: Partial<PeriodInput>): PeriodInput => ({
  from: "2026-11-01", to: "2026-11-30", earnings: [], adjustments: [], costs: [], covers: [], revenue: [],
  driverNames: names, revenueAllocationBasis: "none", ...o,
});

describe("original earnings", () => {
  it("uses the net figure DPD supplied when there is one", () => {
    expect(originalEarnings({ gross: 12000, deductions: 500, additional: 250, netSupplied: 11700 })).toBe(11700);
  });
  it("otherwise derives gross − deductions + additional", () => {
    expect(originalEarnings({ gross: 12000, deductions: 500, additional: 250, netSupplied: null })).toBe(11750);
  });
  it("reports when a supplied net does not match the row's own arithmetic", () => {
    expect(netDiscrepancy({ gross: 12000, deductions: 500, additional: 250, netSupplied: 11750 })).toBe(0);
    expect(netDiscrepancy({ gross: 12000, deductions: 500, additional: 250, netSupplied: 11700 })).toBe(-50);
    expect(netDiscrepancy({ gross: 12000, deductions: 500, additional: 250, netSupplied: null })).toBeNull();
  });
});

describe("pay adjustments", () => {
  it("adjusted pay = original + additional payments − deductions", () => {
    const totals = totalAdjustments([adj({ amount: 5000 }), adj({ type: "deduction", amount: -2500 })]);
    expect(totals).toEqual({ additionalPayments: 5000, deductions: 2500, net: 2500 });
    expect(adjustedPay(12000, totals)).toBe(14500);
  });

  it("a zero-value withheld payment is recorded but changes nothing", () => {
    const totals = totalAdjustments([adj({ type: "withheld_payment", amount: 0 })]);
    expect(totals).toEqual({ additionalPayments: 0, deductions: 0, net: 0 });
    expect(adjustedPay(12000, totals)).toBe(12000);
  });

  it("a reversed adjustment and its reversal cancel exactly", () => {
    const original = adj({ id: "orig", amount: 5000 });
    const reversal = adj({ amount: -5000, reversesId: "orig" });
    const kept = adj({ type: "deduction", amount: -1000 });
    const totals = totalAdjustments([original, reversal, kept]);
    expect(totals).toEqual({ additionalPayments: 0, deductions: 1000, net: -1000 });
  });
});

describe("period summary", () => {
  it("separates revenue, driver pay and operating expenses", () => {
    const s = summarisePeriod(input({
      earnings: [earning({ gross: 12000 }), earning({ date: "2026-11-03", gross: 13000 })],
      adjustments: [adj({ amount: 5000 }), adj({ type: "deduction", amount: -2500 })],
      costs: [
        cost({ amount: 6000, allocation: { scope: "driver", driverId: "d1" } }),
        cost({ kind: "expense", amount: 15000, categoryId: "cat-tyres", categoryName: "Tyres", categoryKind: "vehicle", allocation: { scope: "franchise" } }),
      ],
      revenue: [rev({ amount: 60000 })],
    }));
    const f = s.franchises[0]!;
    expect(f.revenueTotal).toBe(60000);
    expect(f.driverOriginalEarnings).toBe(25000);
    expect(f.driverAdjustmentsNet).toBe(2500);
    expect(f.driverCosts).toBe(27500);
    expect(f.fuel).toBe(6000);
    expect(f.otherExpenses).toBe(15000);
    expect(f.operatingCosts).toBe(48500);
    expect(f.operatingProfit).toBe(11500);
    expect(f.profitStatus).toBe("confirmed");
    expect(f.marginPercent).toBe(19.2);
  });

  it("never invents profit: no revenue entered means profit is unavailable", () => {
    const s = summarisePeriod(input({ earnings: [earning({})] }));
    const f = s.franchises[0]!;
    expect(f.revenueStatus).toBe("unavailable");
    expect(f.operatingProfit).toBeNull();
    expect(f.marginPercent).toBeNull();
    expect(f.driverCosts).toBe(12000);
  });

  it("labels profit as estimated when any revenue is an estimate", () => {
    const s = summarisePeriod(input({
      earnings: [earning({})],
      revenue: [rev({ amount: 20000 }), rev({ amount: 5000, status: "estimated", periodStart: "2026-11-10", periodEnd: "2026-11-10" })],
    }));
    const f = s.franchises[0]!;
    expect(f.revenueConfirmed).toBe(20000);
    expect(f.revenueEstimated).toBe(5000);
    expect(f.profitStatus).toBe("estimated");
    expect(f.operatingProfit).toBe(13000);
  });

  it("counts every cost exactly once and in exactly one bucket", () => {
    const costs = [
      cost({ amount: 1111, allocation: { scope: "driver", driverId: "d1" } }),
      cost({ amount: 2222, allocation: { scope: "franchise" } }),
      cost({ amount: 3333 }),
      cost({ kind: "expense", amount: 4444, categoryId: "c1", categoryName: "Repairs", categoryKind: "vehicle", allocation: { scope: "driver", driverId: "d2" } }),
      cost({ kind: "expense", amount: 5555, categoryId: "c2", categoryName: "Parking", categoryKind: "other" }),
      // A manually-entered expense in the Fuel category counts as fuel, not as "other".
      cost({ kind: "expense", amount: 777, categoryId: "c-fuel", categoryName: "Fuel", categoryKind: "fuel", allocation: { scope: "franchise" } }),
    ];
    const s = summarisePeriod(input({ costs }));
    const f = s.franchises[0]!;
    expect(f.fuel).toBe(1111 + 2222 + 3333 + 777);
    expect(f.otherExpenses).toBe(4444 + 5555);
    expect(f.fuel + f.otherExpenses).toBe(sumPence(costs.map((c) => c.amount)));
    expect(f.unallocatedCosts).toBe(3333 + 5555);
    for (const c of f.categories) {
      expect(c.allocatedToDrivers + c.franchiseGeneral + c.unallocated).toBe(c.total);
    }
    expect(sumPence(f.categories.map((c) => c.total))).toBe(f.fuel + f.otherExpenses);
    expect(sumPence(f.drivers.map((d) => d.fuel + d.otherExpenses))).toBe(1111 + 4444);
  });

  it("keeps unregistered report rows visible and separate", () => {
    const s = summarisePeriod(input({
      earnings: [earning({}), earning({ driverId: null, driverKey: "new person", sourceDriverName: "New Person", gross: 9000 })],
    }));
    const f = s.franchises[0]!;
    expect(f.drivers.map((d) => [d.name, d.registered])).toEqual([["Alex Example", true], ["New Person", false]]);
    expect(f.driverOriginalEarnings).toBe(21000);
  });

  it("calculates per-parcel, per-stop and per-day performance", () => {
    const s = summarisePeriod(input({
      earnings: [
        earning({ date: "2026-11-02", parcels: 100, stops: 80, gross: 12000 }),
        earning({ date: "2026-11-03", parcels: 110, stops: 90, gross: 13000 }),
        earning({ date: "2026-11-04", parcels: 90, stops: 70, gross: 11000 }),
      ],
    }));
    const d = s.franchises[0]!.drivers[0]!;
    expect(d.daysWorked).toBe(3);
    expect(d.parcels).toBe(300);
    expect(d.stops).toBe(240);
    expect(d.earningsPerParcel).toBe(120);
    expect(d.earningsPerStop).toBe(150);
    expect(d.parcelsPerStopX100).toBe(125);
    expect(d.avgEarningsPerDay).toBe(12000);
    expect(d.avgStopsPerDayX10).toBe(800);
    expect(d.avgParcelsPerDayX10).toBe(1000);
  });

  it("does not present ratios when a count is missing", () => {
    const s = summarisePeriod(input({ earnings: [earning({ stops: null }), earning({ date: "2026-11-03" })] }));
    const d = s.franchises[0]!.drivers[0]!;
    expect(d.stopsIncomplete).toBe(true);
    expect(d.earningsPerStop).toBeNull();
    expect(d.avgStopsPerDayX10).toBeNull();
    expect(d.earningsPerParcel).toBe(120);
  });

  it("ignores rows outside the period", () => {
    const s = summarisePeriod(input({
      earnings: [earning({}), earning({ date: "2026-10-31", gross: 99999 }), earning({ date: "2026-12-01", gross: 99999 })],
      adjustments: [adj({ date: "2026-12-01", amount: 99999 })],
      costs: [cost({ date: "2026-10-31", amount: 99999 })],
      revenue: [rev({ periodStart: "2026-10-01", periodEnd: "2026-10-31", amount: 99999 })],
    }));
    const f = s.franchises[0]!;
    expect(f.driverCosts).toBe(12000);
    expect(f.fuel).toBe(0);
    expect(f.revenueStatus).toBe("unavailable");
  });
});

describe("revenue allocation", () => {
  const base = {
    earnings: [
      earning({ driverId: "d1", driverKey: "a", stops: 80, parcels: 100, gross: 12000 }),
      earning({ driverId: "d2", driverKey: "b", stops: 40, parcels: 100, gross: 6000 }),
      earning({ driverId: "d3", driverKey: "c", stops: 30, parcels: 50, gross: 5000 }),
    ],
    revenue: [rev({ amount: 100001 })],
  };

  it("is not attempted unless a basis is configured", () => {
    const s = summarisePeriod(input(base));
    expect(s.franchises[0]!.drivers.every((d) => d.allocatedRevenue === null && d.contribution === null)).toBe(true);
  });

  it("shares revenue by stops and always sums to the revenue", () => {
    const s = summarisePeriod(input({ ...base, revenueAllocationBasis: "stops" }));
    const drivers = s.franchises[0]!.drivers;
    expect(sumPence(drivers.map((d) => d.allocatedRevenue ?? 0))).toBe(100001);
    const alex = drivers.find((d) => d.driverId === "d1")!;
    expect(alex.allocatedRevenue).toBe(53334);
    expect(alex.contribution).toBe(53334 - 12000);
    expect(alex.contributionStatus).toBe("estimated");
  });

  it("is unavailable when there is no revenue to share", () => {
    const s = summarisePeriod(input({ earnings: base.earnings, revenueAllocationBasis: "stops" }));
    expect(s.franchises[0]!.drivers.every((d) => d.allocatedRevenue === null)).toBe(true);
  });
});

describe("driver cover and cost attribution", () => {
  const cover = (o: Partial<CoverRow>): CoverRow => ({
    id: "cv1", franchiseId: F1, date: "2026-11-02", originalDriverId: "d1", coveringDriverId: "d2",
    expenseAttribution: "covering", status: "active", ...o,
  });
  const fuel = cost({ amount: 6000, allocation: { scope: "driver", driverId: "d1" } });

  it("leaves costs with the original driver by default", () => {
    expect(effectiveAllocation(fuel, [cover({ expenseAttribution: "original" })])).toEqual({ scope: "driver", driverId: "d1" });
  });
  it("moves the day's costs to the covering driver when the owner chose that", () => {
    expect(effectiveAllocation(fuel, [cover({})])).toEqual({ scope: "driver", driverId: "d2" });
  });
  it("can charge the day's costs to the franchise instead", () => {
    expect(effectiveAllocation(fuel, [cover({ expenseAttribution: "franchise" })])).toEqual({ scope: "franchise" });
  });
  it("ignores cancelled cover and other dates", () => {
    expect(effectiveAllocation(fuel, [cover({ status: "cancelled" })])).toEqual({ scope: "driver", driverId: "d1" });
    expect(effectiveAllocation(fuel, [cover({ date: "2026-11-03" })])).toEqual({ scope: "driver", driverId: "d1" });
  });
  it("cover transfers move pay between drivers without changing the franchise total", () => {
    const s = summarisePeriod(input({
      earnings: [earning({ driverId: "d1", gross: 12000 })],
      adjustments: [
        adj({ driverId: "d2", type: "cover_payment", amount: 12000, coverRecordId: "cv1" }),
        adj({ driverId: "d1", type: "deduction", amount: -12000, coverRecordId: "cv1" }),
      ],
    }));
    const f = s.franchises[0]!;
    expect(f.driverCosts).toBe(12000);
    expect(f.drivers.find((d) => d.driverId === "d1")!.finalEarnings).toBe(0);
    expect(f.drivers.find((d) => d.driverId === "d2")!.finalEarnings).toBe(12000);
  });
});

describe("reconciliation", () => {
  // A deterministic pseudo-random data set: the identities must hold for any data.
  function generate(seed: number): PeriodInput {
    let x = seed;
    const rnd = (n: number) => { x = (x * 1103515245 + 12345) % 2147483648; return x % n; };
    const earnings: EarningRow[] = [];
    const adjustments: AdjustmentRow[] = [];
    const costs: CostRow[] = [];
    const drivers = ["d1", "d2", "d3"];
    for (let day = 1; day <= 28; day++) {
      const date = `2026-11-${String(day).padStart(2, "0")}`;
      for (const [i, d] of drivers.entries()) {
        if (rnd(7) === 0) continue;
        const gross = 8000 + rnd(9000);
        const ded = rnd(4) === 0 ? rnd(1500) : 0;
        const add = rnd(5) === 0 ? rnd(2000) : 0;
        earnings.push(earning({
          franchiseId: i === 2 ? F2 : F1, driverId: d, driverKey: d, date, gross, deductions: ded, additional: add,
          netSupplied: rnd(2) === 0 ? gross - ded + add : null, parcels: 60 + rnd(90), stops: 40 + rnd(70),
        }));
        if (rnd(6) === 0) adjustments.push(adj({ franchiseId: i === 2 ? F2 : F1, driverId: d, date, amount: rnd(10000) - 5000, type: "other" }));
        if (rnd(3) === 0) {
          costs.push(cost({
            franchiseId: i === 2 ? F2 : F1, date, amount: 2000 + rnd(7000),
            allocation: rnd(3) === 0 ? { scope: "unallocated" } : rnd(2) === 0 ? { scope: "franchise" } : { scope: "driver", driverId: d },
          }));
        }
      }
    }
    return input({
      earnings, adjustments, costs,
      revenue: [rev({ franchiseId: F1, amount: 900000 + rnd(100000) }), rev({ franchiseId: F2, amount: 400000 + rnd(100000) })],
      revenueAllocationBasis: "earnings",
    });
  }

  it.each([1, 7, 42, 1234, 99999])("original + adjustments = final adjusted earnings (seed %i)", (seed) => {
    const data = generate(seed);
    const s = summarisePeriod(data);

    for (const f of s.franchises) {
      for (const d of f.drivers) {
        // Per driver
        expect(d.originalEarnings + d.adjustmentsNet).toBe(d.finalEarnings);
        expect(d.originalEarnings + d.additionalPayments - d.deductions).toBe(d.finalEarnings);
      }
      // Per franchise: the sum of the drivers is the franchise figure
      expect(sumPence(f.drivers.map((d) => d.finalEarnings))).toBe(f.driverCosts);
      expect(f.driverOriginalEarnings + f.driverAdditionalPayments - f.driverDeductions).toBe(f.driverCosts);
      expect(f.driverCosts + f.fuel + f.otherExpenses).toBe(f.operatingCosts);
      expect(f.revenueTotal - f.operatingCosts).toBe(f.operatingProfit);
      expect(sumPence(f.drivers.map((d) => d.allocatedRevenue ?? 0))).toBe(f.revenueTotal);
    }

    // Against the raw rows, independently of the summary code
    const rawOriginal = sumPence(data.earnings.map((e) => e.netSupplied ?? e.gross - e.deductions + e.additional));
    const rawAdjustments = sumPence(data.adjustments.map((a) => a.amount));
    const rawCosts = sumPence(data.costs.map((c) => c.amount));
    const rawRevenue = sumPence(data.revenue.map((r) => r.amount));
    expect(s.combined.driverOriginalEarnings).toBe(rawOriginal);
    expect(s.combined.driverAdjustmentsNet).toBe(rawAdjustments);
    expect(s.combined.driverCosts).toBe(rawOriginal + rawAdjustments);
    expect(s.combined.fuel + s.combined.otherExpenses).toBe(rawCosts);
    expect(s.combined.operatingProfit).toBe(rawRevenue - rawOriginal - rawAdjustments - rawCosts);

    // Daily ledger agrees with the period summary
    const days = buildDriverDays(data.earnings, data.adjustments, names);
    expect(sumPence(days.map((d) => d.finalEarnings))).toBe(s.combined.driverCosts);
    for (const day of days) expect(day.originalEarnings + day.adjustmentsNet).toBe(day.finalEarnings);
  });

  it("does not report a combined profit when a franchise with costs has no revenue", () => {
    const s = summarisePeriod(input({
      earnings: [earning({ franchiseId: F1 }), earning({ franchiseId: F2, driverId: "d2", driverKey: "b" })],
      revenue: [rev({ franchiseId: F1, amount: 50000 })],
    }));
    expect(s.franchises.find((f) => f.franchiseId === F1)!.operatingProfit).toBe(38000);
    expect(s.combined.operatingProfit).toBeNull();
    expect(combineFranchises(s.franchises.filter((f) => f.franchiseId === F1)).operatingProfit).toBe(38000);
  });
});

describe("daily ledger", () => {
  it("shows adjustments on days without a DPD report rather than hiding them", () => {
    const days = buildDriverDays([], [adj({ amount: 5000 })], names);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ hasReport: false, originalEarnings: 0, adjustmentsNet: 5000, finalEarnings: 5000 });
  });
});

describe("performance comparison", () => {
  it("compares against the driver's own history", () => {
    const c = comparePerformance(
      { avgEarningsPerDay: 9000, avgStopsPerDayX10: 700, avgParcelsPerDayX10: 1000 },
      { avgEarningsPerDay: 12000, avgStopsPerDayX10: 1000, avgParcelsPerDayX10: 1000, daysWorked: 40 },
    );
    expect(c).toEqual({ earningsPerDayChange: -25, stopsPerDayChange: -30, parcelsPerDayChange: 0, baselineDays: 40 });
  });
  it("makes no comparison without history", () => {
    const c = comparePerformance({ avgEarningsPerDay: 9000, avgStopsPerDayX10: 700, avgParcelsPerDayX10: 1000 }, null);
    expect(c.earningsPerDayChange).toBeNull();
    expect(c.baselineDays).toBe(0);
  });
});
