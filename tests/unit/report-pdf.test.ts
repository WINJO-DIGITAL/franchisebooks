import { describe, expect, it } from "vitest";
import { extractDocument } from "@/lib/ingest/extract";
import { renderMonthlyReportPdf } from "@/lib/reports/pdf";
import { changeText, type MonthlyReport } from "@/lib/reports/monthly";
import { toCsv } from "@/lib/reports/csv";
import { combineFranchises, summarisePeriod, type EarningRow } from "@/lib/finance/calc";

const earning = (o: Partial<EarningRow>): EarningRow => ({
  id: "e1", franchiseId: "f1", driverId: "d1", driverKey: "d1", sourceDriverName: "Alex Example", date: "2026-11-03", parcels: 100, stops: 80,
  gross: 12000, deductions: 0, additional: 0, netSupplied: null, ...o,
});

function report(overrides: Partial<{ revenue: number; revenueStatus: "confirmed" | "estimated" }> = {}): MonthlyReport {
  const summary = summarisePeriod({
    from: "2026-11-01", to: "2026-11-30",
    earnings: [earning({}), earning({ id: "e2", date: "2026-11-04", gross: 13000 })],
    adjustments: [
      { id: "a1", franchiseId: "f1", driverId: "d1", date: "2026-11-03", type: "additional_payment", amount: 5000, reversesId: null, coverRecordId: null },
      { id: "a2", franchiseId: "f1", driverId: "d1", date: "2026-11-04", type: "deduction", amount: -2000, reversesId: null, coverRecordId: null },
    ],
    costs: [{ id: "c1", kind: "fuel", franchiseId: "f1", date: "2026-11-03", amount: 6000, categoryId: null, categoryName: "Fuel", categoryKind: "fuel", allocation: { scope: "unallocated" } }],
    covers: [],
    revenue: overrides.revenue == null ? [] : [{ id: "r1", franchiseId: "f1", periodStart: "2026-11-01", periodEnd: "2026-11-30", amount: overrides.revenue, status: overrides.revenueStatus ?? "confirmed" }],
    driverNames: new Map([["d1", "Alex Example"]]), revenueAllocationBasis: "none",
  });
  const f = summary.franchises[0]!;
  return {
    accountName: "Synthetic Couriers", month: "2026-11", period: null, from: "2026-11-01", to: "2026-11-30", franchiseId: "f1", scopeLabel: "FD-TEST-1 · Synthetic North",
    generatedAt: "2026-12-02T09:00:00Z", totals: f, franchises: [{ ...f, label: "FD-TEST-1" }],
    drivers: f.drivers.map((d) => ({ ...d, franchiseLabel: "FD-TEST-1", routes: ["101", "102"], comparison: { earningsPerDayChange: -12.5, stopsPerDayChange: null, parcelsPerDayChange: null, baselineDays: 30 } })),
    categories: f.categories,
    adjustments: [
      { id: "a1", date: "2026-11-03", driverName: "Alex Example", franchiseLabel: "FD-TEST-1", type: "additional_payment", amount: 5000, reason: "Covered an extra route", isReversal: false, isReversed: false, fromCover: false },
      { id: "a2", date: "2026-11-04", driverName: "Alex Example", franchiseLabel: "FD-TEST-1", type: "deduction", amount: -2000, reason: "Agreed deduction", isReversal: false, isReversed: false, fromCover: false },
    ],
    unusual: [], missingData: [{ id: "m1", date: "2026-11-10", type: "missing_fuel", title: "No fuel data for FD-TEST-1 (week of 09/11/2026)", status: "open", actual: null, expected: null }],
    unresolvedImports: [], coverCount: 0, revenueAllocationBasis: "none",
  };
}

async function textOf(r: MonthlyReport): Promise<string> {
  const pdf = await renderMonthlyReportPdf(r);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  return (await extractDocument("report.pdf", new Uint8Array(pdf))).text.replace(/\s+/g, " ");
}

describe("monthly report PDF", () => {
  it("shows original DPD figures, adjustments and final pay separately, in UK format", async () => {
    const text = await textOf(report({ revenue: 100000 }));
    expect(text).toContain("Monthly report: November 2026");
    expect(text).toContain("DPD earnings");
    expect(text).toContain("Adjustments");
    expect(text).toContain("Final pay");
    expect(text).toContain("£250.00"); // original
    expect(text).toContain("+£30.00"); // net adjustment
    expect(text).toContain("£280.00"); // final
    expect(text).toContain("03/11/2026");
    expect(text).toContain("Covered an extra route");
    expect(text).not.toMatch(/\$|undefined|NaN/);
  });
  it("calculates operating profit from revenue minus all costs", async () => {
    const text = await textOf(report({ revenue: 100000 }));
    expect(text).toContain("£1,000.00"); // revenue
    expect(text).toContain("£660.00"); // 280 pay + 60 fuel = 340 → 1000 − 340
    expect(text).toContain("66%");
  });
  it("does not invent profit when no revenue has been entered", async () => {
    const text = await textOf(report());
    expect(text).toContain("Not entered");
    expect(text).toContain("Not available");
    expect(text).toContain("never treated as revenue");
    expect(text).not.toContain("£660.00");
  });
  it("labels estimated revenue and profit as estimates", async () => {
    const text = await textOf(report({ revenue: 100000, revenueStatus: "estimated" }));
    expect(text).toContain("ESTIMATED");
    expect(text).toContain("estimates");
  });
  it("lists missing data and unallocated costs", async () => {
    const text = await textOf(report({ revenue: 100000 }));
    expect(text).toContain("No fuel data for FD-TEST-1");
    expect(text).toMatch(/unallocated/i);
  });
  it("produces a consolidated multi-franchise report", async () => {
    const r = report({ revenue: 100000 });
    const second = { ...r.franchises[0]!, franchiseId: "f2", label: "FD-TEST-2" };
    const combined = combineFranchises([r.franchises[0]!, second]);
    const text = await textOf({ ...r, franchiseId: null, scopeLabel: "All franchises (consolidated)", franchises: [r.franchises[0]!, second], totals: combined });
    expect(text).toContain("All franchises (consolidated)");
    expect(text).toContain("By franchise");
    expect(text).toContain("FD-TEST-2");
  });
  it("describes performance changes in words", () => {
    expect(changeText(-12.5)).toBe("-12.5%");
    expect(changeText(8)).toBe("+8%");
    expect(changeText(0)).toBe("Same as usual");
    expect(changeText(null)).toBe("No history");
  });
});

describe("CSV export", () => {
  it("quotes properly and neutralises spreadsheet formulas", () => {
    const csv = toCsv(["Name", "Note"], [["=HYPERLINK(\"x\")", "a, \"b\""], ["Plain", "-12.50"], ["@cmd", "+1"]]);
    const lines = csv.trim().split("\r\n");
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")","a, ""b"""`);
    expect(lines[2]).toBe("Plain,-12.50");
    expect(lines[3]).toBe("'@cmd,'+1");
  });
});

function periodReport(dayRates: { driverId: string; dayRate: number; effectiveFrom: string }[]): MonthlyReport {
  const summary = summarisePeriod({
    from: "2026-11-09", to: "2026-12-06",
    earnings: [earning({ date: "2026-11-10", gross: 20000 }), earning({ id: "e2", date: "2026-11-11", gross: 25000 })],
    adjustments: [], covers: [], revenue: [], driverNames: new Map([["d1", "Alex Example"]]), revenueAllocationBasis: "none",
    costs: [{ id: "c1", kind: "expense", franchiseId: "f1", date: "2026-11-09", amount: 9000, categoryId: "cat", categoryName: "DPD charges", categoryKind: "other", allocation: { scope: "franchise" } }],
    earningsMeaning: "route_income", dayRates,
  });
  const f = summary.franchises[0]!;
  return {
    accountName: "Synthetic Couriers", month: "2026-11", period: { start: "2026-11-09", end: "2026-12-06" }, from: "2026-11-09", to: "2026-12-06", franchiseId: "f1",
    scopeLabel: "FD-TEST-1", generatedAt: "2026-12-08T20:40:00Z", totals: f, franchises: [{ ...f, label: "FD-TEST-1" }],
    drivers: f.drivers.map((d) => ({ ...d, franchiseLabel: "FD-TEST-1", routes: ["101", "102"], comparison: { earningsPerDayChange: null, stopsPerDayChange: null, parcelsPerDayChange: null, baselineDays: 0 } })),
    categories: f.categories, adjustments: [], unusual: [], missingData: [], unresolvedImports: [], coverCount: 0, revenueAllocationBasis: "none",
  };
}

describe("four-week period report PDF (income model)", () => {
  it("titles the period and shows income, wages, charges and profit", async () => {
    const text = await textOf(periodReport([{ driverId: "d1", dayRate: 12000, effectiveFrom: "2026-10-01" }]));
    expect(text).toContain("Period report: 09/11/2026 to 06/12/2026");
    expect(text).toContain("Total income");
    expect(text).toContain("£450.00"); // income
    expect(text).toContain("Driver wages");
    expect(text).toContain("£240.00"); // 2 days x £120
    expect(text).toContain("£90.00"); // DPD charges
    expect(text).toContain("£120.00"); // profit: 450 - 240 - 90
    expect(text).not.toContain("Wages are incomplete");
    expect(text).not.toMatch(/\$|undefined|NaN/);
  });

  it("does not state profit when a driver has no day rate, and says so", async () => {
    const text = await textOf(periodReport([]));
    expect(text).toContain("Wages are incomplete");
    expect(text).toContain("no rate");
    expect(text).toContain("Not available"); // operating profit
    expect(text).toContain("Income less expenses, before wages");
    expect(text).toContain("£360.00"); // 450 - 90
  });
});
