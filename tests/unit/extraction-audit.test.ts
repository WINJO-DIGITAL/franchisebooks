/**
 * Synthetic extraction cases for the audit of the upload → parse → validate path.
 *
 * Every document and figure here is invented. The expected results follow
 * docs/CORE.md and docs/FINANCE.md: only stated figures, never a guess;
 * charges are before VAT, with stated VAT kept beside them; invoices are
 * parsed as a reference (lines, net, VAT, total, period and dates).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { portalMapSchema } from "@/lib/dpd/portal-map";
import { transformTable } from "@/lib/dpd/table";
import { extractDocument } from "@/lib/ingest/extract";
import { DAILY_PAYMENT_LINE, parseSelfBilledInvoice } from "@/lib/ingest/invoice";
import { AUTO_IMPORT_THRESHOLD, parseDocument } from "@/lib/ingest/parse";

const period = { fd: "FD10001", date: "2026-11-16", period: { start: "2026-11-09", end: "2026-12-06" } } as const;
const map = portalMapSchema.parse(JSON.parse(readFileSync("src/lib/dpd/portal-map.json", "utf8")));
const chargesReport = map.reports.find((r) => r.id === "charges")!;
if (chargesReport.collect.mode !== "table") throw new Error("expected charges to be a table report");
const chargesTransform = chargesReport.collect.transform;

function parseCsv(name: string, text: string) {
  return extractDocument(name, new Uint8Array(Buffer.from(text, "utf8"))).then(parseDocument);
}

function chargesRaw(cells: string[]) {
  return transformTable([["", "Description", "", "Charge", ""], ...cells.map((c) => c.split("|"))], chargesTransform, period);
}

describe("transaction charges: stated VAT (synthetic portal cells)", () => {
  it("keeps the amount before VAT and the stated VAT for the usual “excl. £X VAT” wording", () => {
    const out = chargesRaw(["Fixed costs|Management Fee||£11.47 (excl. £2.29 VAT)|"]);
    expect(out[1]).toEqual(["Fixed costs", "Management Fee", "", "£11.47", "", "2.29", "09/11/2026"]);
  });

  it("reads “excluding” the same way as “excl.”, because both are the wording the portal prints", () => {
    const out = chargesRaw(["Fixed costs|Management Fee||£11.47 (excluding £2.29 VAT)|"]);
    expect(out[1]).toEqual(["Fixed costs", "Management Fee", "", "£11.47", "", "2.29", "09/11/2026"]);
  });

  it("reads a thousands separator in both the amount and the stated VAT", () => {
    const out = chargesRaw(["Variable costs|Temporary Van Hire||£1,234.56 (excl. £246.91 VAT)|"]);
    expect(out[1]).toEqual(["Variable costs", "Temporary Van Hire", "", "£1,234.56", "", "246.91", "09/11/2026"]);
  });

  it("invents no VAT when the cell states only an amount", () => {
    const out = chargesRaw(["Fixed costs|Admin Fee||£5.00|"]);
    expect(out[1]).toEqual(["Fixed costs", "Admin Fee", "", "£5.00", "", "", "09/11/2026"]);
  });

  it("does not treat an “incl. VAT” cell as an excluding-VAT amount", () => {
    // The portal states charges before VAT. A cell that says the figure includes VAT is not the same thing.
    const out = chargesRaw(["Fixed costs|Mystery Fee||£13.76 (incl. £2.29 VAT)|"]);
    const amountCell = out[1]![3]!;
    const vatCell = out[1]![5]!;
    expect(vatCell).toBe("");
    expect(amountCell).not.toBe("£13.76"); // the including-VAT figure must not be stored as the before-VAT amount
  });
});

describe("transaction charges: through to parsed expense rows", () => {
  async function parseCharges(rows: string[][]) {
    const csv = ["Franchise: FD10001,Report date: 09/11/2026", ...rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c}"` : c)).join(","))].join("\n");
    return parseCsv("charges_FD10001_2026-11-09.csv", csv);
  }

  it("stores amount and stated VAT on the expense row", async () => {
    const rows = chargesRaw(["Fixed costs|Management Fee||£11.47 (excl. £2.29 VAT)|", "Fixed costs|Admin Fee||£5.00|"]);
    const doc = await parseCharges(rows);
    expect(doc.documentType).toBe("expense_report");
    expect(doc.expenses.map((e) => [e.description, e.amount, e.vat])).toEqual([
      ["Management Fee", 1147, 229],
      ["Admin Fee", 500, null],
    ]);
  });

  it("flags a VAT cell that cannot be read, instead of silently storing “no VAT”", async () => {
    const rows = [
      ["Category", "Description", "Spacer", "Amount", "Spacer 2", "VAT", "Date"],
      ["Fixed costs", "Management Fee", "", "£11.47", "", "N/A", "09/11/2026"],
    ];
    const doc = await parseCharges(rows);
    const fee = doc.expenses.find((e) => e.description === "Management Fee");
    expect(fee?.vat ?? null).toBeNull();
    expect(doc.issues.some((i) => i.level === "error" && /vat/i.test(i.message) && /Management Fee/.test(i.message))).toBe(true);
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
  });
});

describe("fuel reports: net of VAT (docs/FINANCE.md)", () => {
  it("uses the net (ex-VAT) amount as the cost when the document states both net and gross", async () => {
    const csv = [
      "Date,Registration,Litres,PPL,Net,VAT,Total",
      "12/11/2026,AB12 CDE,52.31,1.459,63.58,12.72,76.30",
    ].join("\n");
    const doc = await parseCsv("fuel.csv", csv);
    expect(doc.documentType).toBe("fuel_report");
    expect(doc.fuel).toHaveLength(1);
    expect(doc.fuel[0]).toMatchObject({ date: "2026-11-12", registration: "AB12CDE", litres: "52.31", total: 6358 });
    expect(doc.issues.some((i) => i.level !== "info" && /used as the cost/.test(i.message) && /total|gross/i.test(i.message) && !/net/i.test(i.message))).toBe(false);
  });

  it("warns when only a gross/total is present, so VAT may be included in the cost", async () => {
    const csv = [
      "Date,Registration,Litres,PPL,Total",
      "12/11/2026,AB12 CDE,52.31,1.459,76.30",
    ].join("\n");
    const doc = await parseCsv("fuel.csv", csv);
    expect(doc.fuel[0]?.total).toBe(7630);
    expect(doc.issues.some((i) => i.level !== "info" && /VAT|gross|net/i.test(i.message))).toBe(true);
  });
});

describe("self-billed invoice text (synthetic OCR-style fixtures)", () => {
  const sample = readFileSync("tests/fixtures/dpd-invoice-ocr.txt", "utf8");

  it("still reads the heading when “Total exc VAT” is written with “excl” or “ex”", () => {
    for (const wording of ["Total excl VAT £7,303.36", "Total ex VAT £7,303.36", "Total excluding VAT £7,303.36"]) {
      const text = sample.replace("TotalexcVAT £7,303.36", wording);
      const inv = parseSelfBilledInvoice(text);
      expect(inv, wording).not.toBeNull();
      expect(inv!.netTotal, wording).toBe(730336);
      expect(inv!.reconciled, wording).toBe(true);
    }
  });

  it("returns null, rather than inventing dates or totals, when the period is missing", () => {
    const text = sample.replace(/period 12\/10\/2026 to 08\/11\/2026/, "period");
    expect(parseSelfBilledInvoice(text)).toBeNull();
  });

  it("keeps a missing due date as null instead of computing one from the invoice date", () => {
    const text = sample.replace("Due date: 13/11/2026", "");
    const inv = parseSelfBilledInvoice(text)!;
    expect(inv.dueDate).toBeNull();
    expect(inv.invoiceDate).toBe("2026-11-08");
    expect(inv.reconciled).toBe(true);
  });

  it("does not treat a US-style numeric date as a UK date (day first)", () => {
    // 11/08/2026 is 11 August in the UK, not 8 November.
    const text = sample.replace("Invoice date: 08/11/2026", "Invoice date: 11/08/2026");
    const inv = parseSelfBilledInvoice(text)!;
    expect(inv.invoiceDate).toBe("2026-08-11");
  });
});

describe("earnings rows: ambiguous and incomplete figures", () => {
  it("does not import a row whose gross cannot be read, and does not store zero in its place", async () => {
    const csv = "Date,Driver,Parcels,Stops,Gross\n14/11/2026,Alex Example,100,80,£12?.00\n";
    const doc = await parseCsv("export.csv", csv);
    expect(doc.earnings).toEqual([]);
    expect(doc.issues.some((i) => i.level === "error" && /Alex Example/.test(i.message))).toBe(true);
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
  });

  it("does not choose a report date when two labelled dates are present", async () => {
    const csv = "Report date: 14/11/2026\nDelivery date: 13/11/2026\nDriver,Parcels,Stops,Gross\nAlex Example,100,80,120.00\n";
    const doc = await parseCsv("export.csv", csv);
    expect(doc.reportDate).toBeNull();
    expect(doc.earnings).toEqual([]);
  });

  it("holds identical repeated rows for a person instead of adding them together", async () => {
    const csv = "Date,Driver,Route,Parcels,Stops,Gross\n16/10/2026,Alex Example,564,100,80,120.00\n16/10/2026,Alex Example,564,100,80,120.00\n";
    const doc = await parseCsv("export.csv", csv);
    expect(doc.earnings).toHaveLength(1);
    expect(doc.earnings[0]?.gross).toBe(12000);
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
  });
});

describe("invoice extra lines versus daily payments (docs/CORE.md and period check)", () => {
  it("treats Fuel Supplement and C&D App as extras, not daily stop pay", () => {
    expect(DAILY_PAYMENT_LINE.test("Fuel Supplement")).toBe(false);
    expect(DAILY_PAYMENT_LINE.test("C&D App")).toBe(false);
    expect(DAILY_PAYMENT_LINE.test("Successful collection and delivery stops Saturday")).toBe(true);
  });
});
