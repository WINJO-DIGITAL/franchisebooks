/**
 * Interprets extracted grids as earnings, fuel or expense records.
 *
 * Guiding rule: never guess. A value that cannot be read exactly is reported
 * as an issue and lowers the document's confidence score; it is never
 * replaced with zero. Documents below the import threshold are sent to the
 * owner's review queue instead of being stored.
 */

import { isISODate, parseUkDate, type ISODate } from "@/lib/dates";
import { formatGBP, parseMoney, parseRate, rateTimes, type Pence } from "@/lib/money";
import {
  classifyHeader, isTotalsRow, looksLikeHeader, mapEarningsColumns, mapExpenseColumns, mapFuelColumns,
  normaliseHeader, type DocumentType,
} from "./columns";
import type { ExtractedDocument } from "./extract";

export const PARSER_VERSION = "tabular-v1";
/** Documents scoring below this are held for review rather than imported. */
export const AUTO_IMPORT_THRESHOLD = 0.85;

export interface ParseIssue {
  level: "info" | "warning" | "error";
  message: string;
  row?: number;
}

export interface ParsedEarningsRow {
  line: number;
  driverName: string;
  driverRef: string | null;
  date: ISODate;
  route: string | null;
  parcels: number | null;
  stops: number | null;
  payPerParcel: string | null;
  payPerStop: string | null;
  gross: Pence;
  deductions: Pence;
  additional: Pence;
  net: Pence | null;
  /** Parcels beyond the stops, paid at 5p each. Shown on the DPD Payments table. */
  excessParcels: number | null;
  mileage: number | null;
  /** What the stops paid, and what the excess parcels paid, which add up to the day's total. */
  stopPay: Pence | null;
  parcelPay: Pence | null;
}

export interface ParsedFuelRow {
  line: number;
  date: ISODate;
  time: string | null;
  description: string | null;
  supplier: string | null;
  registration: string | null;
  driverName: string | null;
  cardReference: string | null;
  litres: string | null;
  pricePerLitre: string | null;
  /** Before VAT when vatBasis is "net"; as charged (VAT included) when "gross"; as stated when "not_stated". */
  total: Pence;
  /** The VAT the file states for the row. Null when it states none. */
  vat: Pence | null;
  /**
   * What the amount is. net: before VAT (a net column, or a total less the VAT the file states). gross: the file says the
   * total includes VAT but not how much. not_stated: the file says nothing about VAT. No rate is ever assumed.
   */
  vatBasis: "net" | "gross" | "not_stated";
  reference: string | null;
}

export interface ParsedExpenseRow {
  line: number;
  date: ISODate;
  description: string;
  supplier: string | null;
  categoryText: string | null;
  /** As the document states it. For DPD charges this is before VAT. */
  amount: Pence;
  /** The VAT the document states for the row, added on top of the amount. Null when it states none. */
  vat: Pence | null;
  reference: string | null;
  registration: string | null;
  driverName: string | null;
}

export interface ParsedDocument {
  documentType: DocumentType;
  parser: string;
  /** 0–1. How sure we are that every figure was read correctly. */
  confidence: number;
  issues: ParseIssue[];
  reportDate: ISODate | null;
  dateFrom: ISODate | null;
  dateTo: ISODate | null;
  /** True when the document's own totals line matched the rows; null when it has no totals line. */
  totalsVerified: boolean | null;
  earnings: ParsedEarningsRow[];
  fuel: ParsedFuelRow[];
  expenses: ParsedExpenseRow[];
  /** True when the report has its column headings but no rows at all: nothing was paid or reported for that day. */
  emptyReport?: boolean;
}

const DATE_PATTERN =
  String.raw`(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:[A-Za-z]+,? )?\d{1,2}(?:st|nd|rd|th)?[ \-][A-Za-z]{3,9}[ \-,]+\d{2,4})`;

/** Finds the report date stated in the document's heading text, if there is exactly one candidate. */
export function findReportDate(text: string): ISODate | null {
  const labelled = new RegExp(String.raw`(?:report|delivery|earnings|statement|work|trading)?\s*date\s*[:\-–]?\s*${DATE_PATTERN}`, "gi");
  const found = new Set<ISODate>();
  for (const match of text.matchAll(labelled)) {
    const date = parseUkDate(match[1]);
    if (date) found.add(date);
  }
  if (found.size === 0) {
    const forDate = new RegExp(String.raw`\b(?:for|on)\s+${DATE_PATTERN}`, "gi");
    for (const match of text.matchAll(forDate)) {
      const date = parseUkDate(match[1]);
      if (date) found.add(date);
    }
  }
  return found.size === 1 ? [...found][0]! : null;
}

function cell(row: string[], index: number | undefined): string {
  return index === undefined ? "" : (row[index] ?? "").trim();
}

function parseCount(text: string): number | null | "invalid" {
  if (text === "") return null;
  const cleaned = text.replace(/,/g, "");
  if (!/^\d+$/.test(cleaned)) return "invalid";
  return Number(cleaned);
}

function normaliseRegistration(text: string): string | null {
  const reg = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return reg.length >= 2 && reg.length <= 8 ? reg : null;
}

function parseDecimal(text: string, maxDp: number): string | null | "invalid" {
  if (text === "") return null;
  const cleaned = text.replace(/,/g, "").replace(/\s*(l|ltr|ltrs|litres)$/i, "");
  if (!new RegExp(String.raw`^\d+(\.\d{1,${maxDp}})?$`).test(cleaned)) return "invalid";
  return cleaned;
}

interface TableLocation {
  grid: number;
  headerRow: number;
  header: string[];
  type: DocumentType;
}

function findTables(doc: ExtractedDocument): TableLocation[] {
  const tables: TableLocation[] = [];
  doc.grids.forEach((grid, gridIndex) => {
    for (let r = 0; r < grid.rows.length; r++) {
      const row = grid.rows[r]!;
      if (!looksLikeHeader(row)) continue;
      const type = classifyHeader(row);
      if (type === "unknown") continue;
      const previous = tables[tables.length - 1];
      // A repeated heading (new page) continues the same table.
      if (previous && previous.grid === gridIndex && previous.header.map(normaliseHeader).join("|") === row.map(normaliseHeader).join("|")) continue;
      tables.push({ grid: gridIndex, headerRow: r, header: row, type });
    }
  });
  return tables;
}

function dataRowsOf(doc: ExtractedDocument, table: TableLocation, next: TableLocation | undefined): { row: string[]; line: number }[] {
  const rows = doc.grids[table.grid]!.rows;
  const end = next && next.grid === table.grid ? next.headerRow : rows.length;
  const headerKey = table.header.map(normaliseHeader).join("|");
  const out: { row: string[]; line: number }[] = [];
  for (let r = table.headerRow + 1; r < end; r++) {
    const row = rows[r]!;
    if (row.map(normaliseHeader).join("|") === headerKey) continue;
    out.push({ row, line: r + 1 });
  }
  return out;
}

class Confidence {
  private value = 1;
  private cap = 1;
  reduce(amount: number) {
    this.value = Math.max(0, this.value - amount);
  }
  limit(max: number) {
    this.cap = Math.min(this.cap, max);
  }
  get result(): number {
    return Math.round(Math.min(this.value, this.cap) * 1000) / 1000;
  }
}

const empty = (type: DocumentType, issues: ParseIssue[], confidence = 0): ParsedDocument => ({
  documentType: type, parser: PARSER_VERSION, confidence, issues, reportDate: null, dateFrom: null, dateTo: null,
  totalsVerified: null, earnings: [], fuel: [], expenses: [],
});

export function parseDocument(doc: ExtractedDocument): ParsedDocument {
  if (doc.kind === "unsupported") {
    return empty("unknown", [{ level: "error", message: "This file type is not supported. Upload a PDF, CSV or Excel (.xlsx) file." }]);
  }
  if (doc.grids.length === 0 || doc.text.trim() === "") {
    return empty("unknown", [{
      level: "error",
      message: doc.kind === "pdf"
        ? "No text could be read from this PDF. It may be a scanned image, which cannot be read automatically."
        : "The file is empty.",
    }]);
  }
  const tables = findTables(doc);
  if (tables.length === 0) {
    return empty("unknown", [{ level: "error", message: "No table of earnings, fuel or expenses with recognisable column headings was found in this document." }]);
  }

  const first = tables[0]!;
  const sameType = tables.filter((t) => t.type === first.type);
  const otherTypes = tables.filter((t) => t.type !== first.type);
  const reportDate = findReportDate(doc.text);
  const confidence = new Confidence();
  const issues: ParseIssue[] = [];
  if (otherTypes.length > 0) {
    issues.push({ level: "warning", message: "This document contains more than one kind of table. Only the first kind was read; please check nothing is missing." });
    confidence.limit(0.8);
  }

  const result = empty(first.type, issues, 0);
  result.reportDate = reportDate;
  let totalsSeen = false;
  let totalsOk = true;

  let nonBlankRows = 0;
  for (const table of sameType) {
    const next = tables[tables.indexOf(table) + 1];
    const rows = dataRowsOf(doc, table, next);
    nonBlankRows += rows.filter((r) => r.row.some((cell) => cell.trim() !== "")).length;
    if (first.type === "earnings_report") {
      const outcome = parseEarningsTable(table.header, rows, reportDate, issues, confidence);
      result.earnings.push(...outcome.rows);
      if (outcome.totalsVerified !== null) {
        totalsSeen = true;
        totalsOk = totalsOk && outcome.totalsVerified;
      }
    } else if (first.type === "fuel_report") {
      const outcome = parseFuelTable(table.header, rows, reportDate, issues, confidence);
      result.fuel.push(...outcome.rows);
      if (outcome.totalsVerified !== null) {
        totalsSeen = true;
        totalsOk = totalsOk && outcome.totalsVerified;
      }
    } else {
      const outcome = parseExpenseTable(table.header, rows, reportDate, issues, confidence);
      result.expenses.push(...outcome.rows);
      if (outcome.totalsVerified !== null) {
        totalsSeen = true;
        totalsOk = totalsOk && outcome.totalsVerified;
      }
    }
  }

  const count = result.earnings.length + result.fuel.length + result.expenses.length;
  if (count === 0 && nonBlankRows === 0) {
    // Headings and nothing under them: DPD sends a report with no rows for a day nobody worked or nothing was paid.
    // That is a fact about the day, not a document that failed to read.
    result.emptyReport = true;
    issues.push({ level: "info", message: "The report has its headings but no rows: nothing was reported for this day." });
  } else if (count === 0) {
    issues.push({ level: "error", message: "The table headings were recognised but no rows could be read." });
    confidence.limit(0);
  }
  result.totalsVerified = totalsSeen ? totalsOk : null;
  if (!totalsSeen) {
    // Nothing in the document to cross-check the rows against.
    confidence.limit(0.9);
    issues.push({ level: "info", message: "The document has no totals line, so the rows could not be cross-checked against a total." });
  } else if (!totalsOk) {
    confidence.limit(0.4);
  }

  const dates = [...result.earnings.map((r) => r.date), ...result.fuel.map((r) => r.date), ...result.expenses.map((r) => r.date)].sort();
  result.dateFrom = dates[0] ?? null;
  result.dateTo = dates[dates.length - 1] ?? null;
  result.confidence = confidence.result;
  return result;
}

// ── Earnings ────────────────────────────────────────────────────────────────

function parseEarningsTable(
  header: string[],
  rows: { row: string[]; line: number }[],
  reportDate: ISODate | null,
  issues: ParseIssue[],
  confidence: Confidence,
): { rows: ParsedEarningsRow[]; totalsVerified: boolean | null } {
  const { columns: col, unknown } = mapEarningsColumns(header);
  const out: ParsedEarningsRow[] = [];
  if (col.driver === undefined || (col.gross === undefined && col.net === undefined)) {
    issues.push({ level: "error", message: "The earnings table is missing a driver column or an earnings column." });
    confidence.limit(0);
    return { rows: out, totalsVerified: null };
  }
  if (col.date === undefined && !reportDate) {
    issues.push({ level: "error", message: "The report date could not be found in this document, so the earnings cannot be assigned to a day." });
    confidence.limit(0);
    return { rows: out, totalsVerified: null };
  }
  if (unknown.length > 0) {
    issues.push({ level: "info", message: `Columns not used: ${unknown.join(", ")}.` });
  }

  let totalsVerified: boolean | null = null;
  const seenRows = new Map<string, ParsedEarningsRow>();

  for (const { row, line } of rows) {
    const nonEmpty = row.filter((c) => c.trim() !== "").length;
    if (nonEmpty === 0) continue;

    if (isTotalsRow(row)) {
      totalsVerified = (totalsVerified ?? true) && checkEarningsTotals(row, col, out, issues, line);
      continue;
    }

    const driverName = cell(row, col.driver).replace(/\s+/g, " ");
    const grossText = cell(row, col.gross);
    const netText = cell(row, col.net);
    const moneyText = grossText || netText;
    if (driverName === "" || moneyText === "") {
      // Footers, notes and page numbers end up here. A line that looks like data but is incomplete is reported.
      if (nonEmpty >= 3 && (driverName !== "" || moneyText !== "")) {
        issues.push({ level: "error", row: line, message: `Line ${line} looks like an earnings row but could not be read completely.` });
        confidence.limit(0.5);
      }
      continue;
    }

    const rowIssues: string[] = [];
    const money = (text: string, label: string, required: boolean): Pence | null => {
      if (text === "") return null;
      const value = parseMoney(text);
      if (value == null) {
        rowIssues.push(`${label} "${text}" could not be read as an amount`);
        if (required) confidence.limit(0.5);
        else confidence.reduce(0.1);
      }
      return value;
    };

    const net = col.net !== undefined ? money(netText, "net earnings", col.gross === undefined) : null;
    const grossParsed = col.gross !== undefined ? money(grossText, "gross earnings", true) : net;
    const deductionsRaw = money(cell(row, col.deductions), "deductions", false);
    const additional = money(cell(row, col.additional), "additional payments", false) ?? 0;
    // Reports show deductions either as a positive figure or as a negative one; store the magnitude.
    const deductions = deductionsRaw == null ? 0 : Math.abs(deductionsRaw);

    const date = col.date !== undefined && cell(row, col.date) !== "" ? parseUkDate(cell(row, col.date)) : reportDate;
    if (!date || !isISODate(date)) {
      rowIssues.push(`date "${cell(row, col.date)}" could not be read`);
      confidence.limit(0.5);
    }

    const parcels = parseCount(cell(row, col.parcels));
    const stops = parseCount(cell(row, col.stops));
    if (parcels === "invalid") { rowIssues.push(`parcels "${cell(row, col.parcels)}" is not a whole number`); confidence.reduce(0.1); }
    if (stops === "invalid") { rowIssues.push(`stops "${cell(row, col.stops)}" is not a whole number`); confidence.reduce(0.1); }

    const rate = (text: string, label: string): string | null => {
      if (text === "") return null;
      const value = parseRate(text);
      if (value == null) { rowIssues.push(`${label} "${text}" could not be read`); confidence.reduce(0.05); }
      return value;
    };
    // Optional details from the DPD Payments table. A cell that cannot be read is simply left out.
    const excessParcels = parseCount(cell(row, col.excessParcels));
    const mileage = parseCount(cell(row, col.mileage));
    const optionalMoney = (text: string): Pence | null => (text === "" ? null : parseMoney(text));
    const payPerParcel = rate(cell(row, col.payPerParcel), "pay per parcel");
    const payPerStop = rate(cell(row, col.payPerStop), "pay per stop");

    if (grossParsed == null || !date) {
      issues.push({ level: "error", row: line, message: `Line ${line} (${driverName}) was not imported: ${rowIssues.join("; ")}.` });
      continue;
    }
    if (rowIssues.length > 0) {
      issues.push({ level: "warning", row: line, message: `Line ${line} (${driverName}): ${rowIssues.join("; ")}.` });
    }

    const parsed: ParsedEarningsRow = {
      line,
      driverName,
      driverRef: cell(row, col.driverRef) || null,
      date,
      route: cell(row, col.route) || null,
      parcels: parcels === "invalid" ? null : parcels,
      stops: stops === "invalid" ? null : stops,
      payPerParcel,
      payPerStop,
      excessParcels: excessParcels === "invalid" ? null : excessParcels,
      mileage: mileage === "invalid" ? null : mileage,
      stopPay: optionalMoney(cell(row, col.stopPay)),
      parcelPay: optionalMoney(cell(row, col.parcelPay)),
      gross: grossParsed,
      deductions,
      additional,
      net: col.gross === undefined ? grossParsed : net,
    };

    // The row's own arithmetic: net should equal gross − deductions + additional.
    if (parsed.net != null && col.gross !== undefined) {
      const expected = parsed.gross - parsed.deductions + parsed.additional;
      if (expected !== parsed.net) {
        issues.push({
          level: "warning", row: line,
          message: `Line ${line} (${driverName}): the net figure ${formatGBP(parsed.net)} is not gross − deductions + additional (${formatGBP(expected)}).`,
        });
        confidence.limit(0.7);
      }
    }
    // Rates × counts should explain the gross when all four are given.
    if (parsed.payPerParcel && parsed.payPerStop && parsed.parcels != null && parsed.stops != null) {
      const expectedGross = (rateTimes(parsed.payPerParcel, parsed.parcels) ?? 0) + (rateTimes(parsed.payPerStop, parsed.stops) ?? 0);
      if (Math.abs(expectedGross - parsed.gross) > 2) {
        issues.push({
          level: "info", row: line,
          message: `Line ${line} (${driverName}): gross ${formatGBP(parsed.gross)} differs from parcels × rate + stops × rate (${formatGBP(expectedGross)}).`,
        });
      }
    }

    const key = `${parsed.driverRef ?? parsed.driverName.toLowerCase()}|${parsed.date}|${parsed.route ?? ""}`;
    const earlier = seenRows.get(key);
    if (earlier) {
      const identical = earlier.gross === parsed.gross && earlier.stops === parsed.stops && earlier.parcels === parsed.parcels
        && earlier.deductions === parsed.deductions && earlier.additional === parsed.additional;
      if (identical) {
        // The same figures twice look like a row listed twice by mistake: keep one and ask for a check.
        issues.push({ level: "error", row: line, message: `Line ${line}: ${driverName} appears twice with identical figures for ${parsed.date}${parsed.route ? ` on route ${parsed.route}` : ""}; the second was ignored.` });
        confidence.limit(0.6);
        continue;
      }
      // Different figures for the same driver, route and day are separate jobs (for example a second run).
      // The ledger holds one row per driver, route and day, so they are added together; nothing is lost.
      earlier.gross += parsed.gross;
      earlier.deductions += parsed.deductions;
      earlier.additional += parsed.additional;
      earlier.parcels = earlier.parcels == null || parsed.parcels == null ? null : earlier.parcels + parsed.parcels;
      earlier.stops = earlier.stops == null || parsed.stops == null ? null : earlier.stops + parsed.stops;
      earlier.net = earlier.net == null || parsed.net == null ? null : earlier.net + parsed.net;
      issues.push({ level: "info", row: line, message: `Line ${line}: ${driverName} has more than one entry for ${parsed.date}${parsed.route ? ` on route ${parsed.route}` : ""}; the figures were added together.` });
      continue;
    }
    seenRows.set(key, parsed);
    out.push(parsed);
  }
  return { rows: out, totalsVerified };
}

function checkEarningsTotals(
  row: string[],
  col: ReturnType<typeof mapEarningsColumns>["columns"],
  rows: ParsedEarningsRow[],
  issues: ParseIssue[],
  line: number,
): boolean {
  let ok = true;
  let compared = 0;
  const compareMoney = (index: number | undefined, label: string, actual: Pence, absolute = false) => {
    const text = cell(row, index);
    if (text === "") return;
    const stated = parseMoney(text);
    if (stated == null) return;
    compared++;
    if ((absolute ? Math.abs(stated) : stated) !== actual) {
      ok = false;
      issues.push({ level: "error", row: line, message: `The ${label} total on the document is ${formatGBP(stated)} but the rows read add up to ${formatGBP(actual)}. Some rows may have been misread.` });
    }
  };
  const compareCount = (index: number | undefined, label: string, actual: number) => {
    const stated = parseCount(cell(row, index));
    if (stated == null || stated === "invalid") return;
    compared++;
    if (stated !== actual) {
      ok = false;
      issues.push({ level: "error", row: line, message: `The ${label} total on the document is ${stated} but the rows read add up to ${actual}. Some rows may have been misread.` });
    }
  };
  const sum = (pick: (r: ParsedEarningsRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
  compareMoney(col.gross, "gross earnings", sum((r) => r.gross));
  compareMoney(col.net, "net earnings", sum((r) => r.net ?? r.gross - r.deductions + r.additional));
  compareMoney(col.deductions, "deductions", sum((r) => r.deductions), true);
  compareMoney(col.additional, "additional payments", sum((r) => r.additional));
  compareCount(col.parcels, "parcels", sum((r) => r.parcels ?? 0));
  compareCount(col.stops, "stops", sum((r) => r.stops ?? 0));
  if (compared === 0) {
    issues.push({ level: "info", row: line, message: "A totals line was found but it contained no figures to check." });
    return true;
  }
  return ok;
}

// ── Fuel ────────────────────────────────────────────────────────────────────

function parseFuelTable(
  header: string[],
  rows: { row: string[]; line: number }[],
  reportDate: ISODate | null,
  issues: ParseIssue[],
  confidence: Confidence,
): { rows: ParsedFuelRow[]; totalsVerified: boolean | null } {
  const { columns: col } = mapFuelColumns(header);
  const out: ParsedFuelRow[] = [];
  // Figures in the app are before VAT (docs/FINANCE.md). Use the stated net amount; if only a total is stated,
  // take the stated VAT off it (£18.00 total with £3.00 VAT is £15.00 before VAT). Never assume a VAT rate.
  const costIndex = col.net ?? col.total;
  const netFromTotal = col.net === undefined && col.total !== undefined && col.vat !== undefined;
  if (costIndex === undefined) {
    issues.push({ level: "error", message: "The fuel table has no total cost column." });
    confidence.limit(0);
    return { rows: out, totalsVerified: null };
  }
  if (col.date === undefined && !reportDate) {
    issues.push({ level: "error", message: "The fuel table has no date column." });
    confidence.limit(0);
    return { rows: out, totalsVerified: null };
  }
  // A total whose heading says it includes VAT ("Total (inc. VAT)") is the amount charged, with VAT in it.
  const totalHeading = col.total !== undefined ? normaliseHeader(header[col.total] ?? "") : "";
  const totalIncludesVat = /\binc(l|luding)?\b.*\bvat\b/.test(totalHeading);
  if (col.net === undefined && col.vat === undefined) {
    issues.push({
      level: "warning",
      message: totalIncludesVat
        ? "The file says its totals include VAT but not how much, so they are shown as VAT-inclusive and the amount before VAT is not known."
        : "Only a total was found and no VAT is stated, so the amount before VAT is not known. It is shown as \"VAT not stated\" and has been held for a person to check.",
    });
    confidence.limit(0.8);
  }
  let grossSum = 0;

  let totalsVerified: boolean | null = null;
  for (const { row, line } of rows) {
    const nonEmpty = row.filter((c) => c.trim() !== "").length;
    if (nonEmpty === 0) continue;
    if (isTotalsRow(row)) {
      const stated = parseMoney(cell(row, costIndex));
      if (stated != null) {
        const actual = netFromTotal ? grossSum : out.reduce((a, r) => a + r.total, 0);
        const ok = stated === actual;
        totalsVerified = (totalsVerified ?? true) && ok;
        if (!ok) issues.push({ level: "error", row: line, message: `The total on the document is ${formatGBP(stated)} but the rows read add up to ${formatGBP(actual)}.` });
      }
      continue;
    }
    const totalText = cell(row, costIndex);
    const dateText = cell(row, col.date);
    if (totalText === "" || (col.date !== undefined && dateText === "")) {
      if (nonEmpty >= 3) {
        issues.push({ level: "error", row: line, message: `Line ${line} looks like a fuel transaction but could not be read completely.` });
        confidence.limit(0.5);
      }
      continue;
    }
    const stated = parseMoney(totalText);
    const date = col.date !== undefined ? parseUkDate(dateText) : reportDate;
    if (stated == null || !date) {
      issues.push({ level: "error", row: line, message: `Line ${line} was not imported: ${stated == null ? `amount "${totalText}"` : `date "${dateText}"`} could not be read.` });
      confidence.limit(0.5);
      continue;
    }
    let total = stated;
    let rowVat: Pence | null = null;
    let vatBasis: ParsedFuelRow["vatBasis"] = col.net !== undefined ? "net" : totalIncludesVat ? "gross" : "not_stated";
    if (netFromTotal) {
      const vatText = cell(row, col.vat);
      const vat = parseMoney(vatText);
      if (vatText === "") {
        issues.push({ level: "warning", row: line, message: `Line ${line}: only a total is stated, with no VAT, so the amount before VAT is not known. It has been held for a person to check.` });
        confidence.limit(0.8);
      } else if (vat == null || Math.abs(vat) > Math.abs(stated)) {
        issues.push({ level: "error", row: line, message: `Line ${line} was not imported: VAT "${vatText}" ${vat == null ? "could not be read" : "is more than the total"}.` });
        confidence.limit(0.5);
        continue;
      } else {
        total = (stated - vat) as Pence;
        rowVat = vat;
        vatBasis = "net";
      }
      grossSum += stated;
    } else if (col.net !== undefined && col.vat !== undefined) {
      // A net column with a VAT column beside it: keep the stated VAT.
      const vatText = cell(row, col.vat);
      const vat = vatText === "" ? null : parseMoney(vatText);
      if (vatText !== "" && vat == null) {
        issues.push({ level: "warning", row: line, message: `Line ${line}: VAT "${vatText}" could not be read, so it was not stored.` });
        confidence.reduce(0.05);
      }
      rowVat = vat;
    }
    const litres = parseDecimal(cell(row, col.litres), 3);
    let ppl = parseDecimal(cell(row, col.pricePerLitre).replace(/^£/, "").replace(/p$/i, ""), 4);
    if (litres === "invalid") { issues.push({ level: "warning", row: line, message: `Line ${line}: litres "${cell(row, col.litres)}" could not be read.` }); confidence.reduce(0.05); }
    if (ppl === "invalid") { issues.push({ level: "warning", row: line, message: `Line ${line}: price per litre "${cell(row, col.pricePerLitre)}" could not be read.` }); confidence.reduce(0.05); }
    // Prices are quoted either in pounds (1.459) or pence (145.9); store pounds.
    if (ppl && ppl !== "invalid" && Number(ppl) > 20) ppl = (Number(ppl) / 100).toFixed(4);
    const timeText = cell(row, col.time);
    out.push({
      line,
      date,
      time: /^\d{1,2}:\d{2}(:\d{2})?$/.test(timeText) ? timeText : null,
      description: cell(row, col.description) || null,
      supplier: cell(row, col.supplier) || null,
      registration: normaliseRegistration(cell(row, col.registration)),
      driverName: cell(row, col.driver) || null,
      cardReference: cell(row, col.card) || null,
      litres: litres === "invalid" ? null : litres,
      pricePerLitre: ppl === "invalid" ? null : ppl,
      total,
      vat: rowVat,
      vatBasis,
      reference: cell(row, col.reference) || null,
    });
  }
  return { rows: out, totalsVerified };
}

// ── Expenses ────────────────────────────────────────────────────────────────

/**
 * Reads an amount that states its VAT in brackets, such as "£15.00 (excl. £3.00 VAT)" or "£18.00 (incl. £3.00 VAT)".
 * Both are simple stated figures: excluding means the amount is before VAT; including means the amount before VAT
 * is the figure minus the stated VAT. Either way £15.00 before VAT plus £3.00 VAT is £18.00. No rate is ever assumed.
 * Returns null when the text has no such bracket; returns a problem when a figure cannot be read or the figures
 * contradict each other (stated VAT larger than an including-VAT figure).
 */
export function readStatedVat(text: string): { amount: Pence | null; vat: Pence | null; problem?: string } | null {
  const m = /^(.*?)\s*\(\s*(excl(?:uding)?|exc|ex|incl(?:uding)?|inc)\.?\s*(?:VAT\s*)?(?:of\s*)?([^()]*?)\s*(?:VAT)?\s*\)\s*$/i.exec(text.trim());
  if (!m) return null;
  const figure = parseMoney(m[1]);
  const vat = parseMoney(m[3]);
  if (figure == null || vat == null || vat < 0) {
    return { amount: null, vat: null, problem: `the amount "${text}" could not be read.` };
  }
  if (!/^inc/i.test(m[2]!)) return { amount: figure, vat };
  if (figure < 0 || vat > figure) {
    return { amount: null, vat: null, problem: `"${text}" states more VAT than the amount it is included in.` };
  }
  return { amount: (figure - vat) as Pence, vat };
}

function parseExpenseTable(
  header: string[],
  rows: { row: string[]; line: number }[],
  reportDate: ISODate | null,
  issues: ParseIssue[],
  confidence: Confidence,
): { rows: ParsedExpenseRow[]; totalsVerified: boolean | null } {
  const { columns: col } = mapExpenseColumns(header);
  const out: ParsedExpenseRow[] = [];
  if (col.amount === undefined || (col.date === undefined && !reportDate)) {
    issues.push({ level: "error", message: "The expenses table needs a date column and an amount column." });
    confidence.limit(0);
    return { rows: out, totalsVerified: null };
  }
  let totalsVerified: boolean | null = null;
  for (const { row, line } of rows) {
    const nonEmpty = row.filter((c) => c.trim() !== "").length;
    if (nonEmpty === 0) continue;
    if (isTotalsRow(row)) {
      const stated = parseMoney(cell(row, col.amount));
      if (stated != null) {
        const actual = out.reduce((a, r) => a + r.amount, 0);
        const ok = stated === actual;
        totalsVerified = (totalsVerified ?? true) && ok;
        if (!ok) issues.push({ level: "error", row: line, message: `The total on the document is ${formatGBP(stated)} but the rows read add up to ${formatGBP(actual)}.` });
      }
      continue;
    }
    const amountText = cell(row, col.amount);
    const dateText = cell(row, col.date);
    if (amountText === "" || (col.date !== undefined && dateText === "")) {
      if (nonEmpty >= 3) {
        issues.push({ level: "error", row: line, message: `Line ${line} looks like an expense but could not be read completely.` });
        confidence.limit(0.5);
      }
      continue;
    }
    const description = cell(row, col.description) || `line ${line}`;
    const stated = readStatedVat(amountText);
    const amount = stated ? stated.amount : parseMoney(amountText);
    const date = col.date !== undefined ? parseUkDate(dateText) : reportDate;
    if (stated?.problem) {
      issues.push({ level: "error", row: line, message: `Line ${line} (${description}) was not imported: ${stated.problem}` });
      confidence.limit(0.5);
      continue;
    }
    if (amount == null || !date) {
      issues.push({ level: "error", row: line, message: `Line ${line} was not imported: ${amount == null ? `amount "${amountText}"` : `date "${dateText}"`} could not be read.` });
      confidence.limit(0.5);
      continue;
    }
    const vatText = col.vat !== undefined ? cell(row, col.vat) : "";
    let vat: Pence | null = stated ? stated.vat : null;
    if (vatText !== "") {
      const columnVat = parseMoney(vatText);
      if (columnVat == null) {
        issues.push({ level: "error", row: line, message: `Line ${line} (${description}): VAT "${vatText}" could not be read, so it was not stored.` });
        confidence.limit(0.5);
      } else if (stated && stated.vat !== columnVat) {
        issues.push({ level: "error", row: line, message: `Line ${line} (${description}) was not imported: the VAT column says ${formatGBP(columnVat)} but the amount says ${formatGBP(stated.vat!)}.` });
        confidence.limit(0.5);
        continue;
      } else {
        vat = columnVat;
      }
    }
    out.push({
      line,
      date,
      description: cell(row, col.description),
      supplier: cell(row, col.supplier) || null,
      categoryText: cell(row, col.category) || null,
      amount,
      vat,
      reference: cell(row, col.reference) || null,
      registration: normaliseRegistration(cell(row, col.registration)),
      driverName: cell(row, col.driver) || null,
    });
  }
  return { rows: out, totalsVerified };
}
