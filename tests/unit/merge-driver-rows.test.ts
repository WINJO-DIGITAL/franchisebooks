import { describe, expect, it } from "vitest";
import { driverIdentity, mergeDriverRows, type DriverSummary } from "@/lib/finance/calc";

const row = (over: Partial<DriverSummary>): DriverSummary => ({
  key: "k",
  driverId: null,
  name: "Alex Example",
  registered: false,
  franchiseId: "f1",
  daysWorked: 10,
  parcels: 100,
  stops: 100,
  parcelsIncomplete: false,
  stopsIncomplete: false,
  originalEarnings: 100_000,
  additionalPayments: 0,
  deductions: 0,
  adjustmentsNet: 0,
  finalEarnings: 100_000,
  fuel: 0,
  otherExpenses: 0,
  allocatedRevenue: null,
  contribution: null,
  contributionStatus: "unavailable",
  earningsPerParcel: null,
  earningsPerStop: null,
  parcelsPerStopX100: null,
  avgEarningsPerDay: null,
  avgStopsPerDayX10: null,
  avgParcelsPerDayX10: null,
  wage: 80_000,
  wageComplete: true,
  ...over,
});

describe("driverIdentity", () => {
  it("uses the driver id when there is one, otherwise a normalised name", () => {
    expect(driverIdentity("d1", "Anything")).toBe("d1");
    expect(driverIdentity(null, "  Jamie   Townsend ")).toBe(driverIdentity(null, "jamie townsend"));
  });
});

describe("mergeDriverRows", () => {
  it("leaves a single row unchanged", () => {
    const r = row({ driverId: "d1" });
    expect(mergeDriverRows([r])).toEqual([r]);
  });

  it("joins one driver who works for two franchises into one row with the figures added", () => {
    const merged = mergeDriverRows([
      row({ driverId: "d1", franchiseId: "f1", daysWorked: 10, originalEarnings: 100_000, wage: 80_000 }),
      row({ driverId: "d1", franchiseId: "f2", daysWorked: 5, originalEarnings: 50_000, wage: 40_000, key: "k2" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.daysWorked).toBe(15);
    expect(merged[0]!.originalEarnings).toBe(150_000);
    expect(merged[0]!.wage).toBe(120_000);
    expect(merged[0]!.wageComplete).toBe(true);
  });

  it("joins an unregistered name that appears under two report references", () => {
    const merged = mergeDriverRows([
      row({ name: "Matthew Jackson", originalEarnings: 36_900, wage: 0 }),
      row({ name: "Matthew Jackson", originalEarnings: 30_443, wage: 0, key: "k2" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.originalEarnings).toBe(67_343);
  });

  it("keeps the wage marked incomplete when one of the rows has no day rate", () => {
    const merged = mergeDriverRows([
      row({ driverId: "d1", wage: 80_000, wageComplete: true }),
      row({ driverId: "d1", wage: null, wageComplete: false, key: "k2" }),
    ]);
    expect(merged[0]!.wage).toBe(80_000);
    expect(merged[0]!.wageComplete).toBe(false);
  });

  it("keeps different people apart", () => {
    const merged = mergeDriverRows([row({ driverId: "d1" }), row({ driverId: "d2", key: "k2" }), row({ name: "Blake Sample", key: "k3" })]);
    expect(merged).toHaveLength(3);
  });
});
