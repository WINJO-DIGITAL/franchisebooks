/**
 * Driver statement PDF (PDFKit): one A4 page per driver per DPD pay period. UK dates and pounds.
 * Same look as the period report.
 */

import PDFDocument from "pdfkit";
import { formatUkDate } from "@/lib/dates";
import { periodLabel } from "@/lib/finance/periods";
import { formatGBP, type Pence } from "@/lib/money";
import type { StatementContent } from "./build";

const INK = "#16191d";
const MUTED = "#66707c";
const LINE = "#cfcbc0";
const BAND = "#f3f1ea";
const ACCENT = "#b84700";
const MARGIN = 42;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT = PAGE_WIDTH - MARGIN * 2;

/** PDF core fonts have no U+2212 minus sign; use a hyphen. */
const money = (pence: Pence | null | undefined, options?: { signed?: boolean }) => formatGBP(pence, options).replace("−", "-");
const count = (n: number | null) => (n == null ? "-" : n.toLocaleString("en-GB"));

export async function renderDriverStatementPdf(s: StatementContent): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: `${s.title} ${s.number} - ${s.driver.name}`, Author: s.businessName || "Franchise Books" } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Rows shrink a little for a long period, so everything stays on one page.
  const lines = s.rows.length + s.adjustments.length;
  const rowH = lines > 34 ? 11 : lines > 26 ? 12.5 : 14;
  const size = lines > 34 ? 7.5 : 8.5;
  let y = MARGIN;

  // ── Header ──
  doc.rect(MARGIN, y, 3, 22).fill(ACCENT);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(s.title, MARGIN + 10, y + 2, { width: CONTENT / 2 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text("Number", MARGIN + CONTENT / 2, y, { width: CONTENT / 2, align: "right" });
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(s.number, MARGIN + CONTENT / 2, y + 11, { width: CONTENT / 2, align: "right" });
  y += 36;

  const block = (x: number, label: string, linesOut: string[]) => {
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(label.toUpperCase(), x, y, { width: CONTENT / 3 - 8, characterSpacing: 0.5 });
    let ly = y + 11;
    linesOut.forEach((text, i) => {
      doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(i === 0 ? 10 : 9).fillColor(INK).text(text, x, ly, { width: CONTENT / 3 - 8 });
      ly += i === 0 ? 13 : 11.5;
    });
  };
  block(MARGIN, "From", [s.businessName || s.franchise.name, `${s.franchise.name} (${s.franchise.fdNumber})`]);
  block(MARGIN + CONTENT / 3, "Driver", [s.driver.name, ...(s.vat ? [`VAT number ${s.vat.number}`] : [])]);
  block(MARGIN + (CONTENT * 2) / 3, "Pay period", [periodLabel(s.period), `Issued ${formatUkDate(s.issuedOn)}`]);
  y += 54;

  // ── Days ──
  const cols = [
    { title: "Date", width: 72 },
    { title: "Route", width: 150 },
    { title: "Stops", width: 52, align: "right" as const },
    { title: "Parcels", width: 56, align: "right" as const },
    { title: "Rate", width: 90, align: "right" as const },
    { title: "Pay", width: CONTENT - 72 - 150 - 52 - 56 - 90, align: "right" as const },
  ];
  const row = (cells: string[], opts: { bold?: boolean; band?: boolean; color?: string } = {}) => {
    if (opts.band) doc.rect(MARGIN, y - 2, CONTENT, rowH).fill(BAND);
    let x = MARGIN;
    cells.forEach((text, i) => {
      const col = cols[i]!;
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(opts.color ?? INK)
        .text(text, x + 3, y + 1, { width: col.width - 6, align: col.align ?? "left", lineBreak: false, ellipsis: true });
      x += col.width;
    });
    y += rowH;
  };
  row(cols.map((c) => c.title), { bold: true, band: true, color: MUTED });
  for (const r of s.rows) {
    const rate = r.rate.basis === "stop" ? `${money(r.rate.amount)} a stop` : `${money(r.rate.amount)} a day`;
    row([formatUkDate(r.date), r.route ?? "-", count(r.stops), count(r.parcels), rate, money(r.pay)]);
  }
  if (s.rows.length === 0) row(["No days worked", "", "", "", "", ""], { color: MUTED });
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(0.5).strokeColor(LINE).stroke();
  y += 3;
  row([`${s.rows.length} day${s.rows.length === 1 ? "" : "s"}`, "", count(s.rows.reduce((a, r) => a + (r.stops ?? 0), 0)), count(s.rows.reduce((a, r) => a + (r.parcels ?? 0), 0)), "Pay for days", money(s.dayPay)], { bold: true });

  // ── Adjustments and cover ──
  y += 8;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Adjustments and cover", MARGIN, y);
  y += 15;
  if (s.adjustments.length === 0) {
    doc.font("Helvetica").fontSize(size).fillColor(MUTED).text("None this period.", MARGIN + 3, y);
    y += rowH;
  }
  for (const a of s.adjustments) {
    const what = `${a.label}${a.reversal ? " (reversal)" : ""}`;
    row([formatUkDate(a.date), what, "", "", "", money(a.amount, { signed: true })]);
    if (a.reason) {
      doc.font("Helvetica").fontSize(size - 1).fillColor(MUTED).text(a.reason, MARGIN + cols[0]!.width + 3, y - 3, { width: 300, lineBreak: false, ellipsis: true });
      y += rowH - 3;
    }
  }

  // ── Totals ──
  y += 10;
  const totalLine = (label: string, value: string, strong = false) => {
    doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(strong ? 12 : 10).fillColor(INK)
      .text(label, MARGIN + CONTENT / 2, y, { width: CONTENT / 4, align: "left" })
      .text(value, MARGIN + (CONTENT * 3) / 4, y, { width: CONTENT / 4, align: "right" });
    y += strong ? 18 : 15;
  };
  doc.moveTo(MARGIN + CONTENT / 2, y - 4).lineTo(MARGIN + CONTENT, y - 4).lineWidth(0.5).strokeColor(LINE).stroke();
  totalLine("Pay for days", money(s.dayPay));
  totalLine("Adjustments and cover", money(s.adjustmentsNet, { signed: true }));
  if (s.vat) {
    totalLine("Total before VAT", money(s.total));
    totalLine(`VAT at ${Math.round(s.vat.rate * 100)}%`, money(s.vat.amount));
  }
  doc.rect(MARGIN + CONTENT / 2, y - 3, CONTENT / 2, 22).fill(BAND);
  y += 1;
  totalLine("Total", money(s.totalPayable), true);

  // ── Notes ──
  y += 12;
  const notes = [
    "Worked out from the days DPD recorded for you, your pay rate, and any adjustments shown above.",
    s.vat ? null : "No VAT is charged.",
    s.title === "Self-billed invoice"
      ? `Self-billed invoice issued by ${s.businessName || s.franchise.name} on behalf of ${s.driver.name}, under the self-billing agreement between you.${s.vat ? " The VAT shown is your output tax due to HMRC." : ""}`
      : null,
    "If anything looks wrong, speak to the office before the next pay day.",
  ].filter((n): n is string => n !== null);
  doc.font("Helvetica").fontSize(8).fillColor(MUTED);
  for (const note of notes) {
    doc.text(note, MARGIN, y, { width: CONTENT });
    y = doc.y + 3;
  }
  doc.page.margins.bottom = 0; // the footer sits in the margin, so it must not start a new page
  doc.fontSize(7).fillColor(MUTED).text(`Franchise Books · ${s.number}`, MARGIN, PAGE_HEIGHT - MARGIN - 6, { width: CONTENT, align: "center", lineBreak: false });

  doc.end();
  return finished;
}
