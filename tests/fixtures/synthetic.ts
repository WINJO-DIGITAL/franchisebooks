/**
 * Synthetic DPD-style documents for tests and local demos.
 *
 * Every name, FD number, registration and figure here is invented. Nothing is
 * taken from a real driver, franchise or DPD document, and the layout is our
 * own approximation of a tabular daily statement — not a copy of DPD's.
 */

import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";

export interface SyntheticEarningsRow {
  driver: string;
  driverId?: string;
  route?: string;
  parcels: number;
  stops: number;
  payPerParcel: number;
  payPerStop: number;
  deductions?: number;
  additional?: number;
}

export const SYNTHETIC_DRIVERS: SyntheticEarningsRow[] = [
  { driver: "Alex Example", driverId: "T1001", route: "R01", parcels: 142, stops: 108, payPerParcel: 0.45, payPerStop: 0.85 },
  { driver: "Blake Sample", driverId: "T1002", route: "R02", parcels: 128, stops: 96, payPerParcel: 0.45, payPerStop: 0.85, deductions: 12.5 },
  { driver: "Casey Testcase", driverId: "T1003", route: "R03", parcels: 155, stops: 117, payPerParcel: 0.45, payPerStop: 0.85, additional: 20 },
  { driver: "Devon Placeholder", driverId: "T1004", route: "R04", parcels: 119, stops: 90, payPerParcel: 0.45, payPerStop: 0.85 },
];

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pence = (n: number) => Math.round(n * 100);

export function earningsFigures(row: SyntheticEarningsRow) {
  const gross = (pence(row.payPerParcel) * row.parcels + pence(row.payPerStop) * row.stops) / 100;
  const deductions = row.deductions ?? 0;
  const additional = row.additional ?? 0;
  const net = (pence(gross) - pence(deductions) + pence(additional)) / 100;
  return { gross, deductions, additional, net };
}

function ukDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export interface EarningsPdfOptions {
  fdNumber: string;
  date: string; // ISO
  rows?: SyntheticEarningsRow[];
  /** Include the totals line (default true). */
  totals?: boolean;
  /** Overstate the gross total by this many pounds to simulate a misread or corrupt document. */
  corruptTotalBy?: number;
  /** Replace a column heading, to simulate a portal layout change. */
  renameHeader?: Record<string, string>;
  /** Replace one cell's text, e.g. { row: 1, column: "Gross", text: "N/A" }. */
  corruptCell?: { row: number; column: string; text: string };
}

/** A one-page synthetic "Daily Earnings Statement" PDF. */
export async function earningsPdf(options: EarningsPdfOptions): Promise<Buffer> {
  const rows = options.rows ?? SYNTHETIC_DRIVERS;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
  doc.fontSize(15).text("Daily Earnings Statement", 36, 36);
  doc.fontSize(8).fillColor("#666").text("SYNTHETIC TEST DOCUMENT — NOT A REAL DPD REPORT", 36, 56).fillColor("#000");
  doc.fontSize(10).text(`Franchise: ${options.fdNumber}`, 36, 76);
  doc.text(`Report date: ${ukDate(options.date)}`, 36, 92);

  const columns: { title: string; x: number; width: number; align: "left" | "right" }[] = [
    { title: "Driver", x: 36, width: 120, align: "left" },
    { title: "Driver ID", x: 160, width: 55, align: "left" },
    { title: "Route", x: 220, width: 40, align: "left" },
    { title: "Parcels", x: 265, width: 50, align: "right" },
    { title: "Stops", x: 320, width: 45, align: "right" },
    { title: "Pay per parcel", x: 370, width: 70, align: "right" },
    { title: "Pay per stop", x: 445, width: 65, align: "right" },
    { title: "Gross", x: 515, width: 60, align: "right" },
    { title: "Deductions", x: 580, width: 65, align: "right" },
    { title: "Additional", x: 650, width: 60, align: "right" },
    { title: "Net", x: 715, width: 60, align: "right" },
  ];
  let y = 122;
  doc.fontSize(9).font("Helvetica-Bold");
  for (const c of columns) doc.text(options.renameHeader?.[c.title] ?? c.title, c.x, y, { width: c.width, align: c.align, lineBreak: false });
  doc.font("Helvetica");
  y += 16;

  const totals = { parcels: 0, stops: 0, gross: 0, deductions: 0, additional: 0, net: 0 };
  rows.forEach((row, index) => {
    const f = earningsFigures(row);
    totals.parcels += row.parcels;
    totals.stops += row.stops;
    totals.gross += pence(f.gross);
    totals.deductions += pence(f.deductions);
    totals.additional += pence(f.additional);
    totals.net += pence(f.net);
    const cells: Record<string, string> = {
      Driver: row.driver,
      "Driver ID": row.driverId ?? "",
      Route: row.route ?? "",
      Parcels: String(row.parcels),
      Stops: String(row.stops),
      "Pay per parcel": `£${row.payPerParcel.toFixed(2)}`,
      "Pay per stop": `£${row.payPerStop.toFixed(2)}`,
      Gross: `£${money(f.gross)}`,
      Deductions: `£${money(f.deductions)}`,
      Additional: `£${money(f.additional)}`,
      Net: `£${money(f.net)}`,
    };
    if (options.corruptCell && options.corruptCell.row === index) cells[options.corruptCell.column] = options.corruptCell.text;
    for (const c of columns) doc.text(cells[c.title] ?? "", c.x, y, { width: c.width, align: c.align, lineBreak: false });
    y += 14;
  });

  if (options.totals !== false) {
    y += 4;
    doc.font("Helvetica-Bold");
    const cells: Record<string, string> = {
      Driver: "Total",
      Parcels: String(totals.parcels),
      Stops: String(totals.stops),
      Gross: `£${money(totals.gross / 100 + (options.corruptTotalBy ?? 0))}`,
      Deductions: `£${money(totals.deductions / 100)}`,
      Additional: `£${money(totals.additional / 100)}`,
      Net: `£${money(totals.net / 100)}`,
    };
    for (const c of columns) if (cells[c.title]) doc.text(cells[c.title]!, c.x, y, { width: c.width, align: c.align, lineBreak: false });
    doc.font("Helvetica");
  }
  doc.fontSize(8).fillColor("#666").text("Page 1 of 1", 36, 540);
  return pdfToBuffer(doc);
}

export interface SyntheticFuelRow {
  date: string; // ISO
  time?: string;
  card?: string;
  registration: string;
  driver?: string;
  site: string;
  product?: string;
  litres: number;
  pricePerLitre: number;
  reference?: string;
}

export function fuelTotal(row: SyntheticFuelRow): number {
  return Math.round(row.litres * row.pricePerLitre * 100) / 100;
}

/** A synthetic fuel-card transaction report as CSV. The cost column is the amount before VAT ("Net"), as fuel cards state it. */
export function fuelCsv(rows: SyntheticFuelRow[], options: { fdNumber?: string; totals?: boolean } = {}): Buffer {
  const lines: string[] = [];
  if (options.fdNumber) lines.push(`Fuel Card Transactions,Franchise: ${options.fdNumber},SYNTHETIC TEST DATA`);
  lines.push("Date,Time,Card,Registration,Driver,Site,Product,Litres,PPL,Net,Reference");
  let total = 0;
  for (const row of rows) {
    const cost = fuelTotal(row);
    total += Math.round(cost * 100);
    lines.push([
      ukDate(row.date), row.time ?? "", row.card ?? "", row.registration, row.driver ?? "", `"${row.site}"`, row.product ?? "Diesel",
      row.litres.toFixed(2), row.pricePerLitre.toFixed(3), cost.toFixed(2), row.reference ?? "",
    ].join(","));
  }
  if (options.totals) lines.push(`Total,,,,,,,,,${(total / 100).toFixed(2)},`);
  return Buffer.from(lines.join("\r\n") + "\r\n", "utf8");
}

export interface SyntheticExpenseRow {
  date: string; // ISO
  description: string;
  supplier?: string;
  category?: string;
  amount: number;
  reference?: string;
  registration?: string;
}

/** A synthetic expenses spreadsheet (.xlsx). */
export async function expensesXlsx(rows: SyntheticExpenseRow[], options: { fdNumber?: string } = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Expenses");
  if (options.fdNumber) sheet.addRow([`Expenses — Franchise ${options.fdNumber} — SYNTHETIC TEST DATA`]);
  sheet.addRow(["Date", "Description", "Supplier", "Category", "Amount", "Reference", "Vehicle Reg"]);
  for (const row of rows) {
    const [y, m, d] = row.date.split("-").map(Number) as [number, number, number];
    sheet.addRow([new Date(Date.UTC(y, m - 1, d)), row.description, row.supplier ?? "", row.category ?? "", row.amount, row.reference ?? "", row.registration ?? ""]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
