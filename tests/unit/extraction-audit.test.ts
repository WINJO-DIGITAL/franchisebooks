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

  it("leaves an “incl. VAT” cell whole so the parser can take the stated VAT off it", () => {
    const out = chargesRaw(["Fixed costs|Mystery Fee||£13.76 (incl. £2.29 VAT)|"]);
    expect(out[1]![3]).toBe("£13.76 (incl. £2.29 VAT)");
    expect(out[1]![5]).toBe("");
  });

  it("keeps a charge's own date when the table has one, and fills the period start only when it is blank", () => {
    const transform = { ...chargesTransform!, headers: ["Category", "Description", "Spacer", "Amount", "Spacer 2", "Date"] };
    const out = transformTable(
      [["", "Description", "", "Charge", "", "Date"], ["Fixed costs", "Management Fee", "", "£11.47 (excl. £2.29 VAT)", "", "12/11/2026"], ["Fixed costs", "Admin Fee", "", "£5.00", "", ""]],
      transform, period,
    );
    expect(out[0]).toEqual(["Category", "Description", "Spacer", "Amount", "Spacer 2", "Date", "VAT"]);
    expect(out[1]![5]).toBe("12/11/2026");
    expect(out[2]![5]).toBe("09/11/2026");
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

  it("£15 before VAT and £3 VAT is £18, whichever way the portal words it", async () => {
    const rows = chargesRaw([
      "Fixed costs|Excl Fee||£15.00 (excl. £3.00 VAT)|",
      "Fixed costs|Excluding Fee||£15.00 (excluding £3.00 VAT)|",
      "Fixed costs|Ex Fee||£15.00 (ex £3.00 VAT)|",
      "Fixed costs|Incl Fee||£18.00 (incl. £3.00 VAT)|",
      "Fixed costs|Including Fee||£18.00 (including VAT £3.00)|",
    ]);
    const doc = await parseCharges(rows);
    expect(doc.expenses.map((e) => [e.description, e.amount, e.vat, e.amount + (e.vat ?? 0)])).toEqual([
      ["Excl Fee", 1500, 300, 1800],
      ["Excluding Fee", 1500, 300, 1800],
      ["Ex Fee", 1500, 300, 1800],
      ["Incl Fee", 1500, 300, 1800],
      ["Including Fee", 1500, 300, 1800],
    ]);
    expect(doc.issues.filter((i) => i.level !== "info")).toEqual([]);
    expect(doc.confidence).toBeGreaterThanOrEqual(AUTO_IMPORT_THRESHOLD);
  });

  it("reads the stated VAT in an uploaded file's amount cell too", async () => {
    const doc = await parseCharges([
      ["Category", "Description", "Amount", "Date"],
      ["Fixed costs", "Management Fee", "£18.00 (incl. £3.00 VAT)", "09/11/2026"],
    ]);
    expect(doc.expenses.map((e) => [e.amount, e.vat])).toEqual([[1500, 300]]);
  });

  it("holds a charge whose printed figures contradict each other", async () => {
    const doc = await parseCharges([
      ["Category", "Description", "Amount", "VAT", "Date"],
      ["Fixed costs", "Too Much VAT", "£2.00 (incl. £3.00 VAT)", "", "09/11/2026"],
      ["Fixed costs", "Two VATs", "£15.00 (excl. £3.00 VAT)", "4.00", "09/11/2026"],
      ["Fixed costs", "Garbled", "£15.00 (excl. £3.0? VAT)", "", "09/11/2026"],
      ["Fixed costs", "Same VAT Twice", "£15.00 (excl. £3.00 VAT)", "3.00", "09/11/2026"],
    ]);
    expect(doc.expenses.map((e) => [e.description, e.amount, e.vat])).toEqual([["Same VAT Twice", 1500, 300]]);
    expect(doc.issues.filter((i) => i.level === "error")).toHaveLength(3);
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
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

  it("holds a file with only a total and no VAT for a person, and never assumes 20%", async () => {
    const csv = [
      "Date,Registration,Litres,PPL,Total",
      "12/11/2026,AB12 CDE,52.31,1.459,76.30",
    ].join("\n");
    const doc = await parseCsv("fuel.csv", csv);
    expect(doc.fuel[0]?.total).toBe(7630);
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
    expect(doc.issues.some((i) => i.level === "warning" && /no VAT is stated/i.test(i.message))).toBe(true);
  });

  it("takes the stated VAT off a total when no net is given: £18.00 total with £3.00 VAT is £15.00", async () => {
    const csv = [
      "Date,Registration,Litres,VAT,Total",
      "12/11/2026,AB12 CDE,10.00,3.00,18.00",
      "13/11/2026,AB12 CDE,20.00,6.00,36.00",
      "Total,,,9.00,54.00",
    ].join("\n");
    const doc = await parseCsv("fuel.csv", csv);
    expect(doc.fuel.map((f) => f.total)).toEqual([1500, 3000]);
    expect(doc.totalsVerified).toBe(true);
    expect(doc.confidence).toBeGreaterThanOrEqual(AUTO_IMPORT_THRESHOLD);
    expect(doc.issues.filter((i) => i.level !== "info")).toEqual([]);
  });

  it("holds a row with a total but a blank VAT cell, and refuses VAT larger than the total", async () => {
    const csv = [
      "Date,Registration,Litres,VAT,Total",
      "12/11/2026,AB12 CDE,10.00,,18.00",
      "13/11/2026,AB12 CDE,10.00,30.00,18.00",
    ].join("\n");
    const doc = await parseCsv("fuel.csv", csv);
    expect(doc.fuel.map((f) => f.total)).toEqual([1800]);
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
    expect(doc.issues.some((i) => i.level === "error" && /more than the total/.test(i.message))).toBe(true);
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

describe("dates: UK day first, ISO as written, impossible dates flagged", () => {
  it("reads ISO dates as written and flags a date that is not a real day", async () => {
    const csv = "Franchise: FD10001,Report date: 09/11/2026\nCategory,Description,Amount,Date\nFixed costs,ISO Fee,£5.00,2026-11-09\nFixed costs,Impossible Fee,£5.00,31/02/2026\nFixed costs,UK Fee,£5.00,09/11/2026\n";
    const doc = await parseCsv("charges_FD10001_2026-11-09.csv", csv);
    expect(doc.expenses.map((e) => [e.description, e.date])).toEqual([["ISO Fee", "2026-11-09"], ["UK Fee", "2026-11-09"]]);
    expect(doc.issues.some((i) => i.level === "error" && /31\/02\/2026/.test(i.message))).toBe(true);
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
  });

  it("does not swap day and month round when the day is over 12 in US order", async () => {
    const csv = "Franchise: FD10001,Report date: 09/11/2026\nCategory,Description,Amount,Date\nFixed costs,US Fee,£5.00,11/25/2026\n";
    const doc = await parseCsv("charges_FD10001_2026-11-09.csv", csv);
    expect(doc.expenses).toEqual([]);
    expect(doc.issues.some((i) => i.level === "error" && /11\/25\/2026/.test(i.message))).toBe(true);
  });

  it("reports an invoice due date that is not a real day instead of guessing", () => {
    const sample = readFileSync("tests/fixtures/dpd-invoice-ocr.txt", "utf8");
    const inv = parseSelfBilledInvoice(sample.replace("Due date: 13/11/2026", "Due date: 31/02/2026"))!;
    expect(inv.dueDate).toBeNull();
    expect(inv.problems.some((p) => /31\/02\/2026/.test(p))).toBe(true);
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
