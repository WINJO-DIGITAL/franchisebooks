import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { otherPaymentsFromInvoices, supportPaymentLabel } from "@/lib/data/period";
import { summarisePeriod, type PeriodInput } from "@/lib/finance/calc";
import { parseSelfBilledInvoice } from "@/lib/ingest/invoice";
import { otherPaymentsNote } from "@/lib/reports/pdf";

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");

describe("one-off DPD documents with no billing period", () => {
  it("reads a Support Payment invoice (Business start) dated on its invoice date, with nil VAT when none is printed", () => {
    const inv = parseSelfBilledInvoice(fixture("dpd-support-payment-ocr.txt"))!;
    expect(inv).toMatchObject({
      kind: "support_payment", invoiceNo: "FI1020123", fdNumber: "FD75486", invoiceDate: "2026-09-13", dueDate: "2026-09-18",
      periodStart: "2026-09-13", periodEnd: "2026-09-13", netTotal: 50000, vatTotal: 0, invoiceTotal: 50000, reconciled: true, totalsAgree: true, refersTo: [],
    });
    expect(inv.lines).toEqual([{ description: "Business start", quantity: 1, rate: "£500.00", amount: 50000, vatCode: null }]);
  });

  it("reads a Self Billed VAT Only Invoice: VAT added to an earlier invoice, with no net of its own", () => {
    const inv = parseSelfBilledInvoice(fixture("dpd-vat-only-ocr.txt"))!;
    expect(inv).toMatchObject({
      kind: "vat_only", invoiceNo: "FVI17562", fdNumber: "FD75486", invoiceDate: "2026-10-11", dueDate: "2026-10-16",
      periodStart: "2026-10-11", periodEnd: "2026-10-11", netTotal: 0, vatTotal: 10000, invoiceTotal: 10000, reconciled: true, lines: [],
    });
    expect(inv.refersTo).toEqual([{ invoiceNo: "FI1020123", docDate: "2026-09-14", net: 50000, vat: 10000 }]);
  });

  it("tolerates recognition slips: missing spaces, a VAT code read as 'Ss', no VAT code at all, several referenced invoices", () => {
    const support = fixture("dpd-support-payment-ocr.txt").replace("Support Payment", "SupportPayment ").replace("Business start 1 £500.00 O £500.00", "Business start | £500.00 £500.00")
      .replace("Invoice no: FI1020123", "Invoice No.: FI 1020123");
    expect(parseSelfBilledInvoice(support)).toMatchObject({ kind: "support_payment", invoiceNo: "FI1020123", netTotal: 50000, reconciled: true });

    const two = fixture("dpd-vat-only-ocr.txt")
      .replace("FI1020123 14/09/2026 GB000000000 S 20% £500.00 £100.00", "FI1020123 14/09/2026 GB000000000 Ss 20% £500.00 £100.00\nFI1020999 15/09/2026 GB000000000 S 20% £250.00 £50.00")
      .replace("VAT £100.00\nInvoice total £100.00", "VAT £150.00\nInvoice total £150.00");
    const inv = parseSelfBilledInvoice(two)!;
    expect(inv.refersTo.map((r) => [r.invoiceNo, r.vat])).toEqual([["FI1020123", 10000], ["FI1020999", 5000]]);
    expect(inv.reconciled).toBe(true);
  });

  it("does not trust a VAT-only invoice whose rows disagree with its VAT total, and never invents VAT", () => {
    const bad = fixture("dpd-vat-only-ocr.txt").replace("VAT £100.00\nInvoice total £100.00", "VAT £120.00\nInvoice total £120.00");
    const inv = parseSelfBilledInvoice(bad)!;
    expect(inv.reconciled).toBe(false);
    expect(inv.problems.join(" ")).toMatch(/VAT rows add up to 100/);
  });

  it("still refuses a document with no billing period that is neither kind", () => {
    const other = fixture("dpd-support-payment-ocr.txt").replace("Support Payment\n", "");
    expect(parseSelfBilledInvoice(other)).toBeNull();
  });
});

describe("a support payment and its VAT-only invoice show as one payment", () => {
  const support = parseSelfBilledInvoice(fixture("dpd-support-payment-ocr.txt"))!;
  const vatOnly = parseSelfBilledInvoice(fixture("dpd-vat-only-ocr.txt"))!;
  const asRow = (i: typeof support, id: string) => ({
    id, franchise_id: "f1", invoice_no: i.invoiceNo, invoice_date: i.invoiceDate, period_start: i.periodStart, period_end: i.periodEnd,
    lines: i.lines, kind: i.kind, net_total: i.netTotal / 100, vat_total: i.vatTotal / 100, refers_to: i.refersTo,
  });

  it("is £500 income dated on the support payment's invoice date, with the £100 VAT shown alongside", () => {
    const payments = otherPaymentsFromInvoices([asRow(support, "s1"), asRow(vatOnly, "v1")]);
    expect(payments).toEqual([expect.objectContaining({
      label: "DPD business start support payment", amount: 50000, vat: 10000, date: "2026-09-13", invoiceNo: "FI1020123 + FVI17562",
    })]);
    expect(supportPaymentLabel(["Business start", "Training"])).toBe("DPD support payment (Business start, Training)");
  });

  it("counts the net once: the VAT-only invoice never adds another £500, and on its own it adds nothing", () => {
    expect(otherPaymentsFromInvoices([asRow(vatOnly, "v1")])).toEqual([]);
    const input: PeriodInput = {
      from: "2026-08-17", to: "2026-09-13", adjustments: [], costs: [], covers: [], revenue: [], earnings: [],
      driverNames: new Map(), revenueAllocationBasis: "none", earningsMeaning: "route_income", dayRates: [],
      otherPayments: otherPaymentsFromInvoices([asRow(support, "s1"), asRow(vatOnly, "v1")]),
    };
    const t = summarisePeriod(input).combined;
    expect(t.otherDpdPayments).toBe(50000);
    expect(t.incomeFromDpd).toBe(50000);
  });

  it("names it in the period report", () => {
    expect(otherPaymentsNote([{ label: "Fuel Supplement", amount: 1, invoiceNo: "x" }, { label: "DPD business start support payment", amount: 50000, vat: 10000, invoiceNo: "y" }]))
      .toBe("Fuel Supplement, DPD business start support payment");
    expect(otherPaymentsNote(undefined)).toBe("Fuel Supplement, C&D App");
  });
});
