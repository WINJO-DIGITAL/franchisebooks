/**
 * Invoice extras are income once (docs/CORE.md rule 2); everything the daily Payments already contain is never added again.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { otherPaymentsFromInvoices } from "@/lib/data/period";
import { summarisePeriod, type PeriodInput } from "@/lib/finance/calc";
import { parseSelfBilledInvoice } from "@/lib/ingest/invoice";

const invoice = parseSelfBilledInvoice(readFileSync("tests/fixtures/dpd-invoice-ocr.txt", "utf8"))!;
const row = {
  id: "inv1", franchise_id: "f1", invoice_no: invoice.invoiceNo, invoice_date: invoice.invoiceDate,
  period_start: invoice.periodStart, period_end: invoice.periodEnd, lines: invoice.lines,
};

describe("invoice extras as income", () => {
  it("takes only the lines the daily Payments do not contain, dated at the period start", () => {
    const extras = otherPaymentsFromInvoices([row]);
    expect(extras.map((e) => [e.label, e.amount, e.date])).toEqual([
      ["C&D App", 923, "2026-10-12"],
      ["Fuel Supplement", 7127, "2026-10-12"],
    ]);
  });

  it("counts an extra once and does not count stop pay or excess parcels twice", () => {
    const input: PeriodInput = {
      from: invoice.periodStart, to: invoice.periodEnd, adjustments: [], costs: [], covers: [], revenue: [],
      driverNames: new Map([["d1", "Alex Example"]]), revenueAllocationBasis: "none", earningsMeaning: "route_income", dayRates: [],
      // One day's Payments row: stop pay and excess parcels are already in here.
      earnings: [{ id: "e1", franchiseId: "f1", driverId: "d1", driverKey: "alex", sourceDriverName: "Alex Example", date: "2026-10-13", parcels: 100, stops: 80, gross: 15000, deductions: 0, additional: 0, netSupplied: null }],
      otherPayments: otherPaymentsFromInvoices([row]),
    };
    const t = summarisePeriod(input).combined;
    expect(t.otherDpdPayments).toBe(923 + 7127);
    expect(t.incomeFromDpd).toBe(15000 + 923 + 7127);
    // None of the invoice's daily lines (£5,782.05 weekday stops, £53.00 excess parcels ...) were added.
    expect(t.incomeFromDpd).toBeLessThan(15000 + 578205);
  });

  it("ignores lines that cannot be read as an amount", () => {
    expect(otherPaymentsFromInvoices([{ ...row, lines: [{ description: "Fuel Supplement" }, { amount: 100 }, "junk"] }])).toEqual([]);
  });
});
