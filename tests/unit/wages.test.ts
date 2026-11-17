import { describe, expect, it } from "vitest";
import { rateOn, wageForDriver, workedDatesByDriver, type DayRate } from "@/lib/finance/wages";

const rates: DayRate[] = [
  { driverId: "a", dayRate: 16000, effectiveFrom: "2026-11-01" },
  { driverId: "a", dayRate: 17500, effectiveFrom: "2026-11-10" },
  { driverId: "b", dayRate: 15000, effectiveFrom: "2026-11-05" },
];

describe("rateOn", () => {
  it("uses the latest rate on or before the date", () => {
    expect(rateOn(rates, "a", "2026-11-09")?.dayRate).toBe(16000);
    expect(rateOn(rates, "a", "2026-11-10")?.dayRate).toBe(17500);
    expect(rateOn(rates, "a", "2026-12-01")?.dayRate).toBe(17500);
  });

  it("returns null before the first rate, and never borrows another driver's rate", () => {
    expect(rateOn(rates, "a", "2026-10-31")).toBeNull();
    expect(rateOn(rates, "b", "2026-11-04")).toBeNull();
  });
});

describe("wageForDriver", () => {
  it("adds each worked day at the rate in force that day", () => {
    const wage = wageForDriver("a", ["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"], rates);
    // 2 days at 160.00 + 2 days at 175.00
    expect(wage).toEqual({ driverId: "a", daysWorked: 4, wage: 2 * 16000 + 2 * 17500, complete: true, missingDates: [] });
  });

  it("counts a day worked on several routes once", () => {
    const wage = wageForDriver("a", ["2026-11-02", "2026-11-02", "2026-11-02"], rates);
    expect(wage.daysWorked).toBe(1);
    expect(wage.wage).toBe(16000);
  });

  it("reports days with no rate as missing rather than counting them as zero", () => {
    const wage = wageForDriver("b", ["2026-11-03", "2026-11-06"], rates);
    expect(wage.complete).toBe(false);
    expect(wage.missingDates).toEqual(["2026-11-03"]);
    expect(wage.wage).toBe(15000);
    expect(wage.daysWorked).toBe(2);
  });

  it("gives zero days, zero wage and complete for a driver with no work", () => {
    expect(wageForDriver("a", [], rates)).toEqual({ driverId: "a", daysWorked: 0, wage: 0, complete: true, missingDates: [] });
  });

  it("keeps past wages unchanged when a later rate is added", () => {
    const before = wageForDriver("a", ["2026-11-09"], rates).wage;
    const after = wageForDriver("a", ["2026-11-09"], [...rates, { driverId: "a", dayRate: 20000, effectiveFrom: "2026-12-01" }]).wage;
    expect(after).toBe(before);
  });
});

describe("workedDatesByDriver", () => {
  it("groups dates by driver", () => {
    const map = workedDatesByDriver([
      { driverId: "a", date: "2026-11-01" },
      { driverId: "a", date: "2026-11-02" },
      { driverId: "b", date: "2026-11-01" },
    ]);
    expect(map.get("a")).toEqual(["2026-11-01", "2026-11-02"]);
    expect(map.get("b")).toEqual(["2026-11-01"]);
  });
});
