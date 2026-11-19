import { describe, expect, it } from "vitest";
import { extractDocument } from "@/lib/ingest/extract";
import { AUTO_IMPORT_THRESHOLD, findReportDate, parseDocument } from "@/lib/ingest/parse";
import { classifyHeader, looksLikeHeader } from "@/lib/ingest/columns";
import { earningsFigures, earningsPdf, expensesXlsx, fuelCsv, fuelTotal, SYNTHETIC_DRIVERS } from "../fixtures/synthetic";

const parse = async (name: string, bytes: Buffer) => parseDocument(await extractDocument(name, new Uint8Array(bytes)));
const p = (n: number) => Math.round(n * 100);

describe("column recognition", () => {
  it("recognises each kind of report from its headings, whatever the order", () => {
    expect(classifyHeader(["Driver", "Parcels", "Stops", "Gross", "Net"])).toBe("earnings_report");
    expect(classifyHeader(["Net", "Stops", "Driver Name", "Gross Earnings", "Parcels Delivered"])).toBe("earnings_report");
    expect(classifyHeader(["Date", "Card", "Registration", "Site", "Litres", "PPL", "Total"])).toBe("fuel_report");
    expect(classifyHeader(["Date", "Description", "Supplier", "Category", "Amount"])).toBe("expense_report");
    expect(classifyHeader(["Colour", "Size", "Weight"])).toBe("unknown");
    expect(looksLikeHeader(["Page 1 of 1"])).toBe(false);
  });
});

describe("report date", () => {
  it("finds a labelled UK date", () => {
    expect(findReportDate("Franchise: FD-TEST-1\nReport date: 14/11/2026")).toBe("2026-11-14");
    expect(findReportDate("Daily earnings for 14 Nov 2026")).toBe("2026-11-14");
  });
  it("refuses to choose between two different dates", () => {
    expect(findReportDate("Report date: 14/11/2026  Delivery date: 13/11/2026")).toBeNull();
  });
});

describe("earnings PDF", () => {
  it("reads every figure exactly and verifies them against the document's totals", async () => {
    const doc = await parse("earnings.pdf", await earningsPdf({ fdNumber: "FD-TEST-1", date: "2026-11-14" }));
    expect(doc.documentType).toBe("earnings_report");
    expect(doc.reportDate).toBe("2026-11-14");
    expect(doc.totalsVerified).toBe(true);
    expect(doc.confidence).toBe(1);
    expect(doc.earnings).toHaveLength(SYNTHETIC_DRIVERS.length);
    for (const [i, source] of SYNTHETIC_DRIVERS.entries()) {
      const f = earningsFigures(source);
      expect(doc.earnings[i]).toMatchObject({
        driverName: source.driver, driverRef: source.driverId, route: source.route, date: "2026-11-14",
        parcels: source.parcels, stops: source.stops, payPerParcel: "0.4500", payPerStop: "0.8500",
        gross: p(f.gross), deductions: p(f.deductions), additional: p(f.additional), net: p(f.net),
      });
    }
  });

  it("holds a document for review when its totals do not match the rows", async () => {
    const doc = await parse("earnings.pdf", await earningsPdf({ fdNumber: "FD-TEST-1", date: "2026-11-14", corruptTotalBy: 10 }));
    expect(doc.totalsVerified).toBe(false);
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
    expect(doc.issues.some((i) => i.level === "error" && i.message.includes("gross earnings total"))).toBe(true);
  });

  it("never turns an unreadable amount into zero", async () => {
    const doc = await parse("earnings.pdf", await earningsPdf({
      fdNumber: "FD-TEST-1", date: "2026-11-14", corruptCell: { row: 1, column: "Gross", text: "N/A" },
    }));
    expect(doc.earnings).toHaveLength(SYNTHETIC_DRIVERS.length - 1);
    expect(doc.earnings.some((r) => r.driverName === "Blake Sample")).toBe(false);
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
    expect(doc.issues.some((i) => i.level === "error" && i.message.includes("Blake Sample"))).toBe(true);
  });

  it("does not import when a layout change removes a required column", async () => {
    const doc = await parse("earnings.pdf", await earningsPdf({
      fdNumber: "FD-TEST-1", date: "2026-11-14", renameHeader: { Driver: "Operative", Gross: "Sum A", Net: "Sum B" },
    }));
    expect(doc.confidence).toBe(0);
    expect(doc.earnings).toEqual([]);
  });

  it("can still import a document with no totals line, at lower confidence", async () => {
    const doc = await parse("earnings.pdf", await earningsPdf({ fdNumber: "FD-TEST-1", date: "2026-11-14", totals: false }));
    expect(doc.totalsVerified).toBeNull();
    expect(doc.confidence).toBe(0.9);
    expect(doc.earnings).toHaveLength(SYNTHETIC_DRIVERS.length);
  });

  it("rejects files that are not readable documents", async () => {
    expect((await parse("photo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]))).confidence).toBe(0);
    expect((await parse("notes.csv", Buffer.from("hello,world\n1,2\n"))).documentType).toBe("unknown");
  });
});

describe("earnings CSV", () => {
  it("reads row-level dates, bracketed negatives and re-ordered columns", async () => {
    const csv = [
      "Date,Net,Gross,Deductions,Driver,Stops,Parcels",
      '13/11/2026,"1,180.25","1,200.00",(19.75),Alex Example,101,140',
      "14/11/2026,95.50,95.50,0.00,Blake Sample,88,120",
      'Total,"1,275.75","1,295.50",19.75,,189,260',
    ].join("\n");
    const doc = await parse("export.csv", Buffer.from(csv));
    expect(doc.documentType).toBe("earnings_report");
    expect(doc.totalsVerified).toBe(true);
    expect(doc.confidence).toBe(1);
    expect(doc.earnings[0]).toMatchObject({ date: "2026-11-13", gross: 120000, deductions: 1975, net: 118025, stops: 101, parcels: 140 });
    expect(doc.dateFrom).toBe("2026-11-13");
    expect(doc.dateTo).toBe("2026-11-14");
  });

  it("flags a net figure that does not follow from the row's own numbers", async () => {
    const csv = "Date,Driver,Parcels,Stops,Gross,Deductions,Net\n14/11/2026,Alex Example,100,80,120.00,10.00,115.00\n";
    const doc = await parse("export.csv", Buffer.from(csv));
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
    expect(doc.issues.some((i) => i.message.includes("net figure"))).toBe(true);
  });

  it("refuses rows it cannot date", async () => {
    const csv = "Driver,Parcels,Stops,Gross\nAlex Example,100,80,120.00\n";
    const doc = await parse("export.csv", Buffer.from(csv));
    expect(doc.confidence).toBe(0);
    expect(doc.earnings).toEqual([]);
  });

  it("reports the same driver listed twice for one day", async () => {
    const csv = "Date,Driver,Parcels,Stops,Gross\n14/11/2026,Alex Example,100,80,120.00\n14/11/2026,Alex Example,100,80,120.00\n";
    const doc = await parse("export.csv", Buffer.from(csv));
    expect(doc.earnings).toHaveLength(1);
    expect(doc.confidence).toBeLessThan(AUTO_IMPORT_THRESHOLD);
  });

  it("adds together separate jobs for the same driver, route and day, so nothing is lost", async () => {
    // Real DPD portal data has a second run for the same driver, route and date, with different figures.
    const csv = "Date,Driver,Route,Parcels,Stops,Gross\n16/10/2026,Daniel Example,564,251,123,248.46\n16/10/2026,Daniel Example,564,182,15,83.35\n16/10/2026,Daniel Example,565,10,5,20.00\n";
    const doc = await parse("export.csv", Buffer.from(csv));
    expect(doc.earnings).toHaveLength(2);
    const combined = doc.earnings.find((e) => e.route === "564")!;
    expect(combined.stops).toBe(138);
    expect(combined.parcels).toBe(433);
    expect(combined.gross).toBe(p(331.81));
    expect(doc.earnings.find((e) => e.route === "565")!.gross).toBe(p(20));
    expect(doc.earnings.reduce((n, e) => n + e.gross, 0)).toBe(p(248.46 + 83.35 + 20));
    expect(doc.confidence).toBeGreaterThanOrEqual(AUTO_IMPORT_THRESHOLD);
    expect(doc.issues.some((i) => i.level === "info" && /added together/.test(i.message))).toBe(true);
    expect(doc.issues.some((i) => i.level === "error")).toBe(false);
  });
});

describe("fuel report", () => {
  const rows = [
    { date: "2026-11-12", time: "06:41", card: "****1234", registration: "AB12 CDE", driver: "Alex Example", site: "Synthetic Services, M1", litres: 52.31, pricePerLitre: 1.459, reference: "TX-0001" },
    { date: "2026-11-13", time: "18:05", card: "****5678", registration: "XY21ZZZ", site: "Sample Fuel Stop", litres: 61.7, pricePerLitre: 1.479, reference: "TX-0002" },
  ];

  it("reads fuel transactions and checks the total", async () => {
    const doc = await parse("fuel.csv", fuelCsv(rows, { fdNumber: "FD-TEST-1", totals: true }));
    expect(doc.documentType).toBe("fuel_report");
    expect(doc.totalsVerified).toBe(true);
    expect(doc.confidence).toBe(1);
    expect(doc.fuel).toHaveLength(2);
    expect(doc.fuel[0]).toMatchObject({
      date: "2026-11-12", time: "06:41", registration: "AB12CDE", driverName: "Alex Example", supplier: "Synthetic Services, M1",
      litres: "52.31", pricePerLitre: "1.459", total: p(fuelTotal(rows[0]!)), reference: "TX-0001", cardReference: "****1234",
    });
    expect(doc.fuel[1]!.driverName).toBeNull();
  });
});

describe("expense spreadsheet", () => {
  it("reads an Excel sheet including real date cells", async () => {
    const doc = await parse("expenses.xlsx", await expensesXlsx([
      { date: "2026-11-03", description: "Two front tyres", supplier: "Synthetic Tyres Ltd", category: "Tyres", amount: 186.4, reference: "INV-77", registration: "AB12 CDE" },
      { date: "2026-11-09", description: "Depot parking permit", supplier: "Sample Council", amount: 45 },
    ], { fdNumber: "FD-TEST-1" }));
    expect(doc.documentType).toBe("expense_report");
    expect(doc.expenses).toHaveLength(2);
    expect(doc.expenses[0]).toMatchObject({
      date: "2026-11-03", description: "Two front tyres", supplier: "Synthetic Tyres Ltd", categoryText: "Tyres",
      amount: 18640, reference: "INV-77", registration: "AB12CDE",
    });
    expect(doc.expenses[1]).toMatchObject({ date: "2026-11-09", amount: 4500, categoryText: null });
    expect(doc.confidence).toBeGreaterThanOrEqual(AUTO_IMPORT_THRESHOLD);
  });
});

describe("a day with nothing in it", () => {
  const headings = "Date,Driver ID,Driver,Route,Parcels,Stops,Pay per parcel,Pay per stop,Gross,Deductions,Additional,Net\n";
  it("is an empty report, not an unrecognised document, when the headings have no rows under them", async () => {
    const doc = await parse("payments_FD75486_2026-11-18.csv", Buffer.from(headings));
    expect(doc.documentType).toBe("earnings_report");
    expect(doc.emptyReport).toBe(true);
    expect(doc.issues.some((i) => i.level === "error")).toBe(false);
  });
  it("still reports rows that exist but could not be read", async () => {
    const doc = await parse("payments_FD75486_2026-11-18.csv", Buffer.from(`${headings}not,a,real,row\n`));
    expect(doc.emptyReport).not.toBe(true);
  });
});
