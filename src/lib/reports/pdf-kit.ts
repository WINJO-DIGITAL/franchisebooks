/**
 * Small PDFKit toolkit for the end-of-period reports (Driver Pay, Profit and Loss, Sliding Scale Discrepancy).
 * A4 portrait, same palette and look as the Period Report.
 */

import PDFDocument from "pdfkit";
import { formatUkDateTime } from "@/lib/dates";
import { formatGBP, type Pence } from "@/lib/money";

export const INK = "#16191d";
export const MUTED = "#66707c";
export const LINE = "#cfcbc0";
export const BAND = "#f3f1ea";
export const GOOD = "#0e5a4e";
export const BAD = "#a3261f";
export const ACCENT = "#b84700";
const MARGIN = 42;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
export const CONTENT = PAGE_WIDTH - MARGIN * 2;

/** PDF core fonts have no U+2212 minus sign; use a hyphen. */
export const money = (pence: Pence | null | undefined, options?: { signed?: boolean }) => formatGBP(pence, options).replace("−", "-");

export interface Column {
  title: string;
  width: number;
  align?: "left" | "right";
}
export type Row = string[] | { group: string };

export interface ReportKit {
  title(input: { account: string; heading: string; scope: string; line: string; generatedAt: string }): void;
  heading(text: string, note?: string): void;
  paragraph(text: string, color?: string): void;
  /** A statement line: label, figure and an optional note. */
  line(label: string, value: string, note?: string, bold?: boolean, options?: { indent?: boolean; color?: string }): void;
  table(columns: Column[], rows: Row[], options?: { footer?: string[]; fontSize?: number }): void;
  finish(footerLabel: string): Promise<Buffer>;
}

export function createReportKit(info: { title: string; author: string }): ReportKit {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: info.title, Author: info.author || "Franchise Books" } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  let y = MARGIN;
  const ensure = (height: number) => {
    if (y + height > PAGE_HEIGHT - MARGIN - 24) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const kit: ReportKit = {
    title({ account, heading, scope, line, generatedAt }) {
      doc.rect(0, 0, PAGE_WIDTH, 6).fill(ACCENT);
      y = MARGIN + 4;
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text((account || "Franchise Books").toUpperCase(), MARGIN, y, { characterSpacing: 0.6 });
      y += 15;
      doc.font("Helvetica-Bold").fontSize(21).fillColor(INK).text(heading, MARGIN, y);
      y += 28;
      doc.font("Helvetica").fontSize(11).fillColor(INK).text(scope, MARGIN, y);
      y += 16;
      doc.fontSize(8.5).fillColor(MUTED).text(`${line}   |   Generated ${formatUkDateTime(generatedAt)}`, MARGIN, y);
      y += 16;
    },
    heading(text, note) {
      ensure(90);
      y += 14;
      doc.rect(MARGIN, y + 1, 3, 13).fill(ACCENT);
      doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(text, MARGIN + 9, y, { lineBreak: false });
      y += 19;
      if (note) {
        doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(note, MARGIN, y, { width: CONTENT });
        y = doc.y + 4;
      }
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(0.8).strokeColor(LINE).stroke();
      y += 8;
    },
    paragraph(text, color = INK) {
      doc.font("Helvetica").fontSize(9.5).fillColor(color);
      const height = doc.heightOfString(text, { width: CONTENT });
      ensure(height + 4);
      doc.text(text, MARGIN, y, { width: CONTENT });
      y += height + 5;
    },
    line(label, value, note, bold = false, options = {}) {
      const x = MARGIN + (options.indent ? 14 : 0);
      const color = options.color ?? INK;
      const noteHeight = note ? doc.font("Helvetica").fontSize(8.5).heightOfString(note, { width: CONTENT - 380 }) : 0;
      const rowHeight = Math.max(17, noteHeight + 5);
      ensure(rowHeight + 2);
      if (bold) doc.rect(MARGIN, y - 2, CONTENT, rowHeight + 2).fill(BAND);
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(color).text(label, x + 6, y, { width: 240 });
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(color).text(value, MARGIN + 250, y, { width: 116, align: "right", lineBreak: false });
      if (note) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(note, MARGIN + 380, y + 1, { width: CONTENT - 380 });
      y += rowHeight;
    },
    table(columns, rows, options = {}) {
      const size = options.fontSize ?? 8.5;
      let stripe = false;
      const header = () => {
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED);
        const titleH = Math.max(...columns.map((c) => doc.heightOfString(c.title.toUpperCase(), { width: c.width - 6 })));
        let x = MARGIN;
        for (const column of columns) {
          doc.text(column.title.toUpperCase(), x + 3, y + 2, { width: column.width - 6, align: column.align ?? "left" });
          x += column.width;
        }
        y += titleH + 8;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(0.8).strokeColor(LINE).stroke();
      };
      const drawGroup = (text: string) => {
        if (y + 40 > PAGE_HEIGHT - MARGIN - 24) { doc.addPage(); y = MARGIN; header(); }
        doc.rect(MARGIN, y + 2, CONTENT, 16).fill(BAND);
        doc.font("Helvetica-Bold").fontSize(size).fillColor(ACCENT).text(text, MARGIN + 4, y + 6, { width: CONTENT - 8, lineBreak: false });
        y += 20;
        stripe = false;
      };
      const drawRow = (cells: string[], bold: boolean) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(INK);
        const rowHeight = Math.max(...cells.map((text, i) => doc.heightOfString(text || " ", { width: columns[i]!.width - 6 }))) + 6;
        if (y + rowHeight > PAGE_HEIGHT - MARGIN - 24) {
          doc.addPage();
          y = MARGIN;
          header();
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(INK);
        }
        if (stripe && !bold) doc.rect(MARGIN, y, CONTENT, rowHeight).fill("#faf9f5");
        stripe = !stripe;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(INK);
        let x = MARGIN;
        cells.forEach((text, i) => {
          const column = columns[i]!;
          doc.text(text || "", x + 3, y + 3, { width: column.width - 6, align: column.align ?? "left" });
          x += column.width;
        });
        y += rowHeight;
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(0.4).strokeColor("#e2dfd7").stroke();
      };
      ensure(40);
      header();
      for (const row of rows) { if (Array.isArray(row)) drawRow(row, false); else drawGroup(row.group); }
      if (options.footer) drawRow(options.footer, true);
      y += 8;
    },
    finish(footerLabel) {
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0;
        doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
        doc.text(footerLabel, MARGIN, PAGE_HEIGHT - MARGIN + 6, { width: CONTENT / 2, lineBreak: false });
        doc.text(`Page ${i + 1} of ${range.count}`, MARGIN + CONTENT / 2, PAGE_HEIGHT - MARGIN + 6, { width: CONTENT / 2, align: "right", lineBreak: false });
      }
      doc.end();
      return finished;
    },
  };
  return kit;
}
