/**
 * Turns a source document (PDF, CSV or Excel) into plain grids of text cells.
 * No interpretation happens here — parsers work on the grids.
 */

import { parse as parseCsv } from "csv-parse/sync";
import { looksLikeHeader } from "./columns";

export type FileKind = "pdf" | "csv" | "xlsx" | "unsupported";

export interface Grid {
  /** Sheet name, "csv" or "document". */
  name: string;
  rows: string[][];
}

export interface ExtractedDocument {
  kind: FileKind;
  /** All text in reading order (used to find FD numbers, dates and titles). */
  text: string;
  grids: Grid[];
}

export function detectFileKind(filename: string, bytes: Uint8Array): FileKind {
  const head = Buffer.from(bytes.subarray(0, 8));
  if (head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const lower = filename.toLowerCase();
  if (head[0] === 0x50 && head[1] === 0x4b) return lower.endsWith(".xlsx") || lower.endsWith(".xlsm") ? "xlsx" : "unsupported";
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) return "csv";
  return "unsupported";
}

export async function extractDocument(filename: string, bytes: Uint8Array): Promise<ExtractedDocument> {
  const kind = detectFileKind(filename, bytes);
  if (kind === "pdf") return extractPdf(bytes);
  if (kind === "csv") return extractCsv(bytes, filename);
  if (kind === "xlsx") return extractXlsx(bytes);
  return { kind, text: "", grids: [] };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function extractCsv(bytes: Uint8Array, filename: string): ExtractedDocument {
  const text = Buffer.from(bytes).toString("utf8").replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = filename.toLowerCase().endsWith(".tsv") || (firstLine.includes("\t") && !firstLine.includes(","))
    ? "\t"
    : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows = parseCsv(text, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  }) as string[][];
  return { kind: "csv", text, grids: [{ name: "csv", rows: rows.map((r) => r.map((c) => String(c ?? "").trim())) }] };
}

// ── Excel ───────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function cellToText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) {
    // Excel dates are calendar dates; read them in UTC so they never shift a day.
    const hasTime = value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0;
    const date = `${pad(value.getUTCDate())}/${pad(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
    return value.getUTCFullYear() < 1901 && hasTime ? `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}` : date;
  }
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("result" in v) return cellToText(v.result);
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t: { text?: string }) => t.text ?? "").join("");
    if ("text" in v) return String(v.text ?? "");
    if ("error" in v) return "";
  }
  return String(value).trim();
}

async function extractXlsx(bytes: Uint8Array): Promise<ExtractedDocument> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const grids: Grid[] = [];
  const textParts: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      const cells = Array.from({ length: values.length }, (_, i) => cellToText(values[i]));
      if (cells.some((c) => c !== "")) {
        rows.push(cells);
        textParts.push(cells.filter(Boolean).join("  "));
      }
    });
    if (rows.length) grids.push({ name: sheet.name, rows });
  });
  return { kind: "xlsx", text: textParts.join("\n"), grids };
}

// ── PDF ─────────────────────────────────────────────────────────────────────

interface PdfItem {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

interface PdfLine {
  y: number;
  cells: { x0: number; x1: number; text: string }[];
}

/** Groups positioned text items into lines, and nearby items on a line into cells. */
function itemsToLines(items: PdfItem[]): PdfLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; items: PdfItem[] }[] = [];
  for (const item of sorted) {
    const tolerance = Math.max(2, item.height * 0.4);
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tolerance);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.map((line) => {
    const row = line.items.sort((a, b) => a.x - b.x);
    const cells: PdfLine["cells"] = [];
    for (const item of row) {
      const last = cells[cells.length - 1];
      // Items separated by less than about one character width belong to the same cell.
      const gapLimit = Math.max(3, item.height * 0.55);
      if (last && item.x - last.x1 <= gapLimit) {
        const needsSpace = item.x - last.x1 > 0.5 && !last.text.endsWith(" ") && !item.text.startsWith(" ");
        last.text += (needsSpace ? " " : "") + item.text;
        last.x1 = Math.max(last.x1, item.x + item.width);
      } else {
        cells.push({ x0: item.x, x1: item.x + item.width, text: item.text });
      }
    }
    return { y: line.y, cells: cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim() })).filter((c) => c.text !== "") };
  });
}

/**
 * Converts lines into a grid. Each maximal run of lines is aligned to the
 * column positions of the widest line in the document region (normally the
 * table header): a cell belongs to the column whose horizontal span it
 * overlaps most, or failing that whose centre is nearest.
 */
function linesToGrid(lines: PdfLine[], headerHint: (texts: string[]) => boolean): string[][] {
  const rows: string[][] = [];
  let columns: { x0: number; x1: number }[] | null = null;

  for (const line of lines) {
    if (line.cells.length === 0) continue;
    const texts = line.cells.map((c) => c.text);
    if (headerHint(texts)) {
      columns = line.cells.map((c) => ({ x0: c.x0, x1: c.x1 }));
      rows.push(texts);
      continue;
    }
    if (!columns) {
      rows.push(texts);
      continue;
    }
    const out = Array.from({ length: columns.length }, () => "");
    for (const cell of line.cells) {
      let best = -1;
      let bestOverlap = 0;
      columns.forEach((col, i) => {
        const overlap = Math.min(cell.x1, col.x1) - Math.max(cell.x0, col.x0);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = i;
        }
      });
      if (best === -1) {
        const centre = (cell.x0 + cell.x1) / 2;
        let bestDistance = Infinity;
        columns.forEach((col, i) => {
          // Numbers are usually right-aligned under their header, text left-aligned.
          const distance = Math.min(Math.abs(centre - (col.x0 + col.x1) / 2), Math.abs(cell.x1 - col.x1), Math.abs(cell.x0 - col.x0));
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
          }
        });
      }
      out[best] = out[best] ? `${out[best]} ${cell.text}` : cell.text;
    }
    rows.push(out);
  }
  return rows;
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  const { getDocumentProxy } = await import("unpdf");
  // unpdf transfers the buffer to a worker; hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const textParts: string[] = [];
  const allLines: PdfLine[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const raw of content.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
        if (!raw.str || !raw.transform || raw.str.trim() === "") continue;
        items.push({
          x: raw.transform[4] ?? 0,
          y: raw.transform[5] ?? 0,
          width: raw.width ?? 0,
          height: raw.height || Math.abs(raw.transform[3] ?? 10) || 10,
          text: raw.str,
        });
      }
      const lines = itemsToLines(items);
      for (const line of lines) textParts.push(line.cells.map((c) => c.text).join("  "));
      allLines.push(...lines);
    }
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.();
  }
  // Pages are read as one continuous table so a table that runs over several
  // pages keeps the column positions of its header.
  const rows = linesToGrid(allLines, looksLikeHeader);
  const grids: Grid[] = rows.length ? [{ name: "document", rows }] : [];
  return { kind: "pdf", text: textParts.join("\n"), grids };
}
