import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSelfBilledInvoice } from "@/lib/ingest/invoice";

// Recognition slips seen on live invoices whose lines did not add up to their own totals. The figures are the real ones
// stored for those invoices; the surrounding text follows the layout of the real recognised invoices.
const read = (name: string) => parseSelfBilledInvoice(readFileSync(`tests/fixtures/dpd-invoice-ocr-${name}.txt`, "utf8"))!;
const sum = (inv: ReturnType<typeof read>) => inv.lines.reduce((n, l) => n + l.amount, 0);

describe("DPD invoices whose lines did not add up", () => {
  it("reads an amount with a stray character for the £ and a lost decimal point (s7,45571 is £7,455.71)", () => {
    const inv = read("amount-no-point");
    expect(inv.lines.map((l) => [l.description, l.amount])).toEqual([
      ["Successful collection and delivery stops Monday - Friday", 745571],
      ["Excess parcels", 5885],
    ]);
    expect(sum(inv)).toBe(751456);
    expect(inv.reconciled).toBe(true);
    expect(inv.problems).toEqual([]);
  });

  it("takes the VAT that makes net plus VAT the invoice total when 'Total exc VAT' is split over two lines", () => {
    const inv = read("vat-split");
    expect(inv.netTotal).toBe(605841);
    // Not £6,058.41 (the net beside a "VAT" label): the £1,211.68 the invoice prints in its VAT analysis.
    expect(inv.vatTotal).toBe(121168);
    expect(inv.netTotal + inv.vatTotal).toBe(inv.invoiceTotal);
    expect(inv.reconciled).toBe(true);
    expect(inv.lines.filter((l) => /fuel|c&d/i.test(l.description)).map((l) => l.amount)).toEqual([923, 866]);
  });

  it("finds the lines when the table heading is garbled ('Descrlption Ouantity')", () => {
    const inv = read("garbled-heading");
    expect(inv.lines).toHaveLength(5);
    expect(sum(inv)).toBe(inv.netTotal);
    expect(inv.reconciled).toBe(true);
  });

  it("keeps a line whose rate was garbled (£0.0S) instead of silently dropping it", () => {
    const inv = read("garbled-rate");
    expect(inv.lines.map((l) => [l.description, l.quantity, l.amount])).toContainEqual(["Excess parcels", 942, 4710]);
    expect(sum(inv)).toBe(617171);
    expect(inv.reconciled).toBe(true);
  });

  it("never makes up a VAT figure the invoice does not print", () => {
    const text = readFileSync("tests/fixtures/dpd-invoice-ocr-vat-split.txt", "utf8").replace(/£1,211\.68/g, "£1,2l1.68");
    const inv = parseSelfBilledInvoice(text);
    // No printed figure makes net plus VAT the total, so there is no VAT to use: the invoice is not read as trusted.
    expect(inv?.reconciled ?? false).toBe(false);
  });

  it("still reports an invoice whose lines really are short of its total", () => {
    const text = readFileSync("tests/fixtures/dpd-invoice-ocr-garbled-rate.txt", "utf8").replace(/^Excess parcels.*\n/m, "");
    const inv = parseSelfBilledInvoice(text)!;
    expect(inv.reconciled).toBe(false);
    expect(inv.totalsAgree).toBe(true);
    expect(inv.problems).toEqual(["The lines add up to 6124.61 but the invoice states 6171.71 excluding VAT."]);
  });
});
