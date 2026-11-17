import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DAILY_PAYMENT_LINE, parseSelfBilledInvoice } from "@/lib/ingest/invoice";

const sample = readFileSync("tests/fixtures/dpd-invoice-ocr.txt", "utf8");

describe("DPD self-billed invoice", () => {
  it("reads the header, period, lines and totals, all excluding VAT until the invoice total", () => {
    const inv = parseSelfBilledInvoice(sample)!;
    expect(inv).not.toBeNull();
    expect(inv.invoiceNo).toBe("FI1041458");
    expect(inv.fdNumber).toBe("FD42102");
    expect(inv.invoiceDate).toBe("2026-11-08");
    expect(inv.dueDate).toBe("2026-11-13");
    expect(inv.periodStart).toBe("2026-10-12");
    expect(inv.periodEnd).toBe("2026-11-08");
    expect(inv.netTotal).toBe(730336);
    expect(inv.vatTotal).toBe(146067);
    expect(inv.invoiceTotal).toBe(876403);
    expect(inv.lines.map((l) => [l.description, l.quantity, l.amount])).toEqual([
      ["Successful collection and delivery stops Monday - Friday", 2548, 578205],
      ["Successful collection and delivery stops Saturday", 335, 80592],
      ["Successful collection and delivery stops Sunday", 240, 58189],
      ["Excess parcels", 1060, 5300],
      ["C&D App", 1, 923],
      ["Fuel Supplement", 4, 7127],
    ]);
  });

  it("checks that the lines add up to the net total and net plus VAT is the invoice total", () => {
    const inv = parseSelfBilledInvoice(sample)!;
    expect(inv.reconciled).toBe(true);
    expect(inv.problems).toEqual([]);
    expect(inv.lines.reduce((n, l) => n + l.amount, 0)).toBe(inv.netTotal);
  });

  it("separates the extra payments (Fuel Supplement, C&D App) from the lines the daily payments already contain", () => {
    const inv = parseSelfBilledInvoice(sample)!;
    const extras = inv.lines.filter((l) => !DAILY_PAYMENT_LINE.test(l.description));
    expect(extras.map((l) => [l.description, l.amount])).toEqual([["C&D App", 923], ["Fuel Supplement", 7127]]);
    // The daily lines match the Payments figures: stop pay plus excess parcels.
    const daily = inv.lines.filter((l) => DAILY_PAYMENT_LINE.test(l.description)).reduce((n, l) => n + l.amount, 0);
    expect(daily).toBe(578205 + 80592 + 58189 + 5300);
  });

  it("counts a stop line whose first words were lost in recognition as daily pay, not an extra payment", () => {
    expect(DAILY_PAYMENT_LINE.test("Monday - Friday:")).toBe(true);
    expect(DAILY_PAYMENT_LINE.test("Successful collection and delivery stops Saturday")).toBe(true);
    expect(DAILY_PAYMENT_LINE.test("Excess parcels")).toBe(true);
    for (const extra of ["C&D App", "Fuel Supplement", "Big Push Top Up", "Enhanced Terms / Rate", "Business start"]) expect(DAILY_PAYMENT_LINE.test(extra)).toBe(false);
  });

  it("says so when the lines do not add up, instead of trusting the invoice", () => {
    const broken = sample.replace("£9.23 Ss £9.23", "£9.23 Ss £19.23");
    const inv = parseSelfBilledInvoice(broken)!;
    expect(inv.reconciled).toBe(false);
    expect(inv.problems.join(" ")).toMatch(/add up/);
  });

  it("returns null for text that is not a self-billed invoice", () => {
    expect(parseSelfBilledInvoice("Remittance Advice FD42102")).toBeNull();
    expect(parseSelfBilledInvoice("")).toBeNull();
  });
});

describe("recognition slips are repaired only when the arithmetic then works", () => {
  it('reads a quantity "1" that came out as "|"', () => {
    const inv = parseSelfBilledInvoice(readFileSync("tests/fixtures/dpd-invoice-ocr-pipe-quantity.txt", "utf8"))!;
    expect(inv.reconciled).toBe(true);
    expect(inv.lines.find((l) => l.description === "C&D App")).toMatchObject({ quantity: 1, amount: 923 });
    expect(inv.netTotal).toBe(546446);
  });

  it('reads a "£" that came out as "6", and keeps every extra line (Big Push Top Up, Enhanced Terms / Rate)', () => {
    const inv = parseSelfBilledInvoice(readFileSync("tests/fixtures/dpd-invoice-ocr-misread-pound.txt", "utf8"))!;
    expect(inv.reconciled).toBe(true);
    expect(inv.lines[0]!.amount).toBe(1122519); // "611,225.19" is £11,225.19
    const extras = inv.lines.filter((l) => !DAILY_PAYMENT_LINE.test(l.description));
    expect(extras.map((l) => [l.description, l.amount])).toEqual([["C&D App", 923], ["Big Push Top Up", 14649], ["Enhanced Terms / Rate", 2883]]);
  });

  it("does not accept a repair that leaves the lines not adding up", () => {
    const inv = parseSelfBilledInvoice(readFileSync("tests/fixtures/dpd-invoice-ocr-misread-pound.txt", "utf8").replace("£1,295.07", "£1,295.00"))!;
    expect(inv.reconciled).toBe(false);
  });
});
