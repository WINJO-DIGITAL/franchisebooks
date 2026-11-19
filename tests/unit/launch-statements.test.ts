import { describe, expect, it } from "vitest";
import type { EarningDetail } from "@/lib/data/period";
import { buildStatementContent, UK_STANDARD_VAT_RATE } from "@/lib/statements/build";
import { periodCode, periodNumberInYear, statementFileName, statementNumber } from "@/lib/statements/numbering";
import { renderDriverStatementPdf } from "@/lib/statements/pdf";

const P11: { start: string; end: string } = { start: "2026-10-12", end: "2026-11-08" };

describe("driver statement numbers", () => {
  it("numbers DPD periods within their calendar year", () => {
    expect(periodNumberInYear({ start: "2026-01-05", end: "2026-02-01" })).toEqual({ year: 2026, number: 1 });
    expect(periodCode(P11)).toBe("2026P11");
    expect(periodCode({ start: "2026-11-09", end: "2026-12-06" })).toBe("2026P12");
    expect(periodCode({ start: "2025-12-08", end: "2026-01-04" })).toBe("2025P13");
  });
  it("gives the FD, the period and the driver's own number, the same every time", () => {
    expect(statementNumber("FD42102", P11, 1)).toBe("FD42102-2026P11-D001");
    expect(statementNumber(" fd42102 ", P11, 1)).toBe("FD42102-2026P11-D001");
    expect(statementNumber("FD42102", P11, 27)).toBe("FD42102-2026P11-D027");
    expect(statementFileName("FD42102-2026P11-D001", "Alex O'Neil")).toBe("FD42102-2026P11-D001-Alex-O-Neil.pdf");
  });
});

const day = (date: string, stops: number | null = 100, extra: Partial<EarningDetail> = {}): EarningDetail => ({
  id: date, franchiseId: "f1", driverId: "d1", driverKey: "alex", sourceDriverName: "Alex", date, route: "R12", parcels: 120, stops,
  payPerParcel: null, payPerStop: null, gross: 30000, deductions: 0, additional: 0, netSupplied: null, importedFileId: "file", source: "dpd_portal", ...extra,
});
const base = {
  number: "FD42102-2026P11-D001", period: P11, businessName: "Example Ltd", franchise: { name: "North", fdNumber: "FD42102" },
  driver: { id: "d1", name: "Alex Example", vatNumber: null, selfBillingAgreement: false }, adjustments: [], issuedOn: "2026-11-09",
};
const dayRate = [{ driverId: "d1", dayRate: 12000, effectiveFrom: "2026-01-01", basis: "day" as const }];

describe("what goes on a driver statement", () => {
  it("shows each day with its route, stops, parcels and rate, and totals them with adjustments", () => {
    const built = buildStatementContent({ ...base, earnings: [day("2026-10-12"), day("2026-10-13")], dayRates: dayRate,
      adjustments: [{ id: "a1", franchiseId: "f1", driverId: "d1", date: "2026-10-13", type: "additional_payment", amount: 2500, reason: "Covered R14", coverRecordId: null, reversesId: null }] });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const s = built.content;
    expect(s.title).toBe("Driver statement");
    expect(s.rows.map((r) => [r.date, r.route, r.stops, r.parcels, r.rate.amount, r.pay])).toEqual([["2026-10-12", "R12", 100, 120, 12000, 12000], ["2026-10-13", "R12", 100, 120, 12000, 12000]]);
    expect(s.dayPay).toBe(24000);
    expect(s.adjustmentsNet).toBe(2500);
    expect(s.total).toBe(26500);
    expect(s.vat).toBeNull();
    expect(s.totalPayable).toBe(26500);
  });

  it("is not made when the driver has no pay rate, and says why (never using DPD's figures instead)", () => {
    const built = buildStatementContent({ ...base, earnings: [day("2026-10-12")], dayRates: [] });
    expect(built).toEqual({ ok: false, reason: "No pay rate set for this driver. Set one under Drivers." });
  });

  it("is not made when a per-stop rate meets a day with no stop count", () => {
    const built = buildStatementContent({ ...base, earnings: [day("2026-10-12", null)], dayRates: [{ ...dayRate[0]!, dayRate: 120, basis: "stop" }] });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toMatch(/no stop count/);
  });

  it("is titled Self-billed invoice only when the agreement is ticked, and shows VAT only with a VAT number", () => {
    const signed = buildStatementContent({ ...base, driver: { ...base.driver, selfBillingAgreement: true }, earnings: [day("2026-10-12")], dayRates: dayRate });
    expect(signed.ok && signed.content.title).toBe("Self-billed invoice");
    expect(signed.ok && signed.content.vat).toBeNull();
    const vat = buildStatementContent({ ...base, driver: { ...base.driver, vatNumber: "GB123456789" }, earnings: [day("2026-10-12")], dayRates: dayRate });
    expect(vat.ok && vat.content.title).toBe("Driver statement");
    expect(vat.ok && vat.content.vat).toEqual({ rate: UK_STANDARD_VAT_RATE, amount: 2400, number: "GB123456789" });
    expect(vat.ok && vat.content.totalPayable).toBe(14400);
  });

  it("renders a full 28-day period on one A4 page", async () => {
    const days = Array.from({ length: 28 }, (_, i) => day(`2026-10-${String(12 + i).padStart(2, "0")}`.replace(/2026-10-(3[2-9]|4\d)/, (m) => `2026-11-${String(Number(m.slice(-2)) - 31).padStart(2, "0")}`)));
    const built = buildStatementContent({ ...base, earnings: days, dayRates: dayRate,
      adjustments: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, franchiseId: "f1", driverId: "d1", date: "2026-10-20", type: "additional_payment" as const, amount: 1000, reason: "Cover", coverRecordId: null, reversesId: null })) });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const pdf = await renderDriverStatementPdf(built.content);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });
});
