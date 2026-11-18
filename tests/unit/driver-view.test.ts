import { describe, expect, it } from "vitest";
import type { EarningDetail } from "@/lib/data/period";
import { buildDriverStatement, type DriverAdjustmentInput } from "@/lib/finance/driver-view";
import type { DayRate } from "@/lib/finance/wages";

const me = "driver-me";
const other = "driver-other";
let n = 0;
const earn = (o: Partial<EarningDetail> & { date: string }): EarningDetail => ({
  id: `e${++n}`, franchiseId: "f1", driverId: me, driverKey: me, sourceDriverName: "Me", parcels: 100, stops: 80, gross: 20000, deductions: 0, additional: 0, netSupplied: null,
  route: "359", payPerParcel: null, payPerStop: null, importedFileId: "file", source: "dpd_portal", mileage: 90, ...o,
});
const adj = (o: Partial<DriverAdjustmentInput>): DriverAdjustmentInput => ({
  id: `a${++n}`, franchiseId: "f1", driverId: me, date: "2026-11-10", type: "additional_payment", amount: 1500, reversesId: null, coverRecordId: null, reason: "Extra route", ...o,
});
const dayRate = (r: number, basis: "day" | "stop" = "day"): DayRate[] => [{ driverId: me, dayRate: r, effectiveFrom: "2026-10-01", basis }];

describe("a driver's statement", () => {
  it("prices each day from their day rate and never shows what DPD paid the franchise", () => {
    const s = buildDriverStatement({ driverId: me, earnings: [earn({ date: "2026-11-09", gross: 99999 }), earn({ date: "2026-11-10", gross: 88888 })], adjustments: [], dayRates: dayRate(12000), meaning: "route_income" });
    expect(s.days.map((d) => d.pay)).toEqual([12000, 12000]);
    expect(s.dayPay).toBe(24000);
    expect(JSON.stringify(s)).not.toContain("99999");
    expect(JSON.stringify(s)).not.toContain("88888");
  });

  it("prices a per-stop rate from the day's stops", () => {
    const s = buildDriverStatement({ driverId: me, earnings: [earn({ date: "2026-11-09", stops: 100 })], adjustments: [], dayRates: dayRate(85, "stop"), meaning: "route_income" });
    expect(s.days[0]?.pay).toBe(8500);
  });

  it("counts a day on two routes as one day, with the routes joined and the stops added", () => {
    const s = buildDriverStatement({
      driverId: me, adjustments: [], dayRates: dayRate(12000), meaning: "route_income",
      earnings: [earn({ date: "2026-11-09", route: "359", stops: 80 }), earn({ date: "2026-11-09", route: "101", stops: 30 })],
    });
    expect(s.daysWorked).toBe(1);
    expect(s.days[0]).toMatchObject({ route: "101 / 359", stops: 110, mileage: 180 });
    expect(s.days[0]?.pay).toBe(12000);
  });

  it("says a day cannot be priced yet when no rate is set, rather than showing zero", () => {
    const s = buildDriverStatement({ driverId: me, earnings: [earn({ date: "2026-11-09" })], adjustments: [], dayRates: [], meaning: "route_income" });
    expect(s.days[0]?.pay).toBeNull();
    expect(s.unpricedDates).toEqual(["2026-11-09"]);
    expect(s.dayPay).toBe(0);
  });

  it("uses DPD's figure as the driver's pay in accounts where DPD pays drivers directly", () => {
    const s = buildDriverStatement({ driverId: me, earnings: [earn({ date: "2026-11-09", gross: 15000, deductions: 500, additional: 200 })], adjustments: [], dayRates: [], meaning: "driver_pay" });
    expect(s.days[0]?.pay).toBe(14700);
  });

  it("adds the driver's own adjustments to the total, and ignores anyone else's", () => {
    const s = buildDriverStatement({
      driverId: me, earnings: [earn({ date: "2026-11-09" })], dayRates: dayRate(12000), meaning: "route_income",
      adjustments: [adj({ amount: 1500 }), adj({ amount: -500, type: "deduction", reason: "Damage" }), adj({ driverId: other, amount: 99900 })],
    });
    expect(s.adjustmentsNet).toBe(1000);
    expect(s.total).toBe(13000);
    expect(s.adjustments).toHaveLength(2);
  });

  it("never includes another driver's days, even if they are passed in by mistake", () => {
    const s = buildDriverStatement({
      driverId: me, adjustments: [], dayRates: dayRate(12000), meaning: "route_income",
      earnings: [earn({ date: "2026-11-09" }), earn({ date: "2026-11-09", driverId: other, route: "777", stops: 500 })],
    });
    expect(s.daysWorked).toBe(1);
    expect(JSON.stringify(s)).not.toContain("777");
  });
});
