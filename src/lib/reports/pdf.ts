/**
 * Monthly report PDF (PDFKit). A4 portrait, UK dates and currency.
 * Original DPD figures and manual adjustments are always shown in separate
 * columns, and every revenue or profit figure carries its status.
 */

import PDFDocument from "pdfkit";
import { formatMonth, formatUkDate, formatUkDateTime } from "@/lib/dates";
import { adjustmentLabel, ANOMALY_STATUS } from "@/lib/labels";
import { formatGBP, type Pence } from "@/lib/money";
import { changeText, type MonthlyReport } from "./monthly";

const INK = "#16191d";
const MUTED = "#66707c";
const LINE = "#cfcbc0";
const ACCENT = "#0e5a4e";
const MARGIN = 42;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT = PAGE_WIDTH - MARGIN * 2;

/** PDF core fonts have no U+2212 minus sign; use a hyphen. */
const money = (pence: Pence | null | undefined, options?: { signed?: boolean }) => formatGBP(pence, options).replace("−", "-");
const STATUS_TEXT: Record<string, string> = { confirmed: "confirmed", estimated: "ESTIMATED", unavailable: "not available" };

interface Column {
  title: string;
  width: number;
  align?: "left" | "right";
}

export async function renderMonthlyReportPdf(report: MonthlyReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `Monthly report ${formatMonth(report.month)} - ${report.scopeLabel}`, Author: report.accountName || "Franchise Manager" } });
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
  const heading = (text: string, note?: string) => {
    ensure(54);
    y += 10;
    doc.font("Helvetica-Bold").fontSize(12.5).fillColor(INK).text(text, MARGIN, y, { lineBreak: false });
    y += 17;
    if (note) {
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(note, MARGIN, y, { width: CONTENT });
      y = doc.y + 4;
    }
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(0.8).strokeColor(LINE).stroke();
    y += 8;
  };
  const paragraph = (text: string, color = INK) => {
    doc.font("Helvetica").fontSize(9.5).fillColor(color);
    const height = doc.heightOfString(text, { width: CONTENT });
    ensure(height + 4);
    doc.text(text, MARGIN, y, { width: CONTENT });
    y += height + 5;
  };
  const table = (columns: Column[], rows: string[][], options: { footer?: string[]; fontSize?: number } = {}) => {
    const size = options.fontSize ?? 8.5;
    const drawRow = (cells: string[], bold: boolean, color: string) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
      const heights = cells.map((text, i) => doc.heightOfString(text || " ", { width: columns[i]!.width - 6 }));
      const rowHeight = Math.max(...heights) + 6;
      if (y + rowHeight > PAGE_HEIGHT - MARGIN - 24) {
        doc.addPage();
        y = MARGIN;
        header();
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
      }
      let x = MARGIN;
      cells.forEach((text, i) => {
        const column = columns[i]!;
        doc.text(text || "", x + 3, y + 3, { width: column.width - 6, align: column.align ?? "left" });
        x += column.width;
      });
      y += rowHeight;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(0.4).strokeColor("#e2dfd7").stroke();
    };
    const header = () => {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED);
      let x = MARGIN;
      for (const column of columns) {
        doc.text(column.title.toUpperCase(), x + 3, y + 2, { width: column.width - 6, align: column.align ?? "left", lineBreak: false });
        x += column.width;
      }
      y += 14;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(0.8).strokeColor(LINE).stroke();
    };
    ensure(40);
    header();
    for (const row of rows) drawRow(row, false, INK);
    if (options.footer) drawRow(options.footer, true, INK);
    y += 8;
  };

  // ── Title block ───────────────────────────────────────────────────────────
  doc.rect(0, 0, PAGE_WIDTH, 6).fill(ACCENT);
  y = MARGIN + 4;
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text((report.accountName || "Franchise Manager").toUpperCase(), MARGIN, y, { characterSpacing: 0.6 });
  y += 15;
  doc.font("Helvetica-Bold").fontSize(21).fillColor(INK).text(`Monthly report: ${formatMonth(report.month)}`, MARGIN, y);
  y += 28;
  doc.font("Helvetica").fontSize(11).fillColor(INK).text(report.scopeLabel, MARGIN, y);
  y += 16;
  doc.fontSize(8.5).fillColor(MUTED).text(`${formatUkDate(report.from)} to ${formatUkDate(report.to)}   |   Generated ${formatUkDateTime(report.generatedAt)}`, MARGIN, y);
  y += 16;

  // ── Franchise overview ────────────────────────────────────────────────────
  const t = report.totals;
  heading("Franchise overview");
  const overview: [string, string, string][] = [
    ["Revenue", t.revenueStatus === "unavailable" ? "Not entered" : money(t.revenueTotal), STATUS_TEXT[t.revenueStatus]!],
    ["Driver costs (pay after adjustments)", money(t.driverCosts), ""],
    ["   of which original DPD earnings", money(t.driverOriginalEarnings), "from DPD documents"],
    ["   of which manual adjustments", money(t.driverAdjustmentsNet, { signed: true }), "entered by hand"],
    ["Fuel costs", money(t.fuel), ""],
    ["Other expenses", money(t.otherExpenses), ""],
    ["Total operating costs", money(t.operatingCosts), ""],
    ["Operating profit", t.operatingProfit == null ? "Not available" : money(t.operatingProfit), t.operatingProfit == null ? "revenue not entered" : STATUS_TEXT[t.profitStatus]!],
    ["Profit margin", t.marginPercent == null ? "Not available" : `${t.marginPercent}%`, ""],
  ];
  for (const [label, value, note] of overview) {
    ensure(16);
    const bold = label === "Operating profit" || label === "Revenue";
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK).text(label, MARGIN, y, { width: 260, lineBreak: false });
    doc.text(value, MARGIN + 260, y, { width: 110, align: "right", lineBreak: false });
    if (note) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(note, MARGIN + 382, y + 1, { width: CONTENT - 382, lineBreak: false });
    y += 16;
  }
  y += 2;
  if (t.revenueStatus === "unavailable") {
    paragraph("No revenue has been entered for this period, so profit cannot be reported. Driver earnings are a cost and are never treated as revenue.", MUTED);
  } else if (t.revenueStatus === "estimated") {
    paragraph("Revenue includes at least one estimated entry, so profit and margin are estimates.", MUTED);
  }
  paragraph(`${t.driverCount} driver${t.driverCount === 1 ? "" : "s"} worked, completing ${t.stops.toLocaleString("en-GB")} stops and ${t.parcels.toLocaleString("en-GB")} parcels.`, MUTED);

  if (!report.franchiseId && report.franchises.length > 1) {
    heading("By franchise");
    table(
      [{ title: "Franchise", width: 151 }, { title: "Revenue", width: 76, align: "right" }, { title: "Driver costs", width: 76, align: "right" }, { title: "Fuel", width: 66, align: "right" }, { title: "Other", width: 66, align: "right" }, { title: "Profit", width: 76, align: "right" }],
      report.franchises.map((f) => [
        f.label, f.revenueStatus === "unavailable" ? "Not entered" : `${money(f.revenueTotal)}${f.revenueStatus === "estimated" ? " (est.)" : ""}`,
        money(f.driverCosts), money(f.fuel), money(f.otherExpenses),
        f.operatingProfit == null ? "n/a" : `${money(f.operatingProfit)}${f.profitStatus === "estimated" ? " (est.)" : ""}`,
      ]),
    );
  }

  // ── Driver breakdown ──────────────────────────────────────────────────────
  heading("Driver breakdown", "“DPD earnings” are the original figures from DPD documents. “Adjustments” are manual entries. “Final pay” is the two added together.");
  if (report.drivers.length === 0) paragraph("No driver earnings were recorded for this period.", MUTED);
  else {
    const sum = (pick: (d: MonthlyReport["drivers"][number]) => number) => report.drivers.reduce((a, d) => a + pick(d), 0);
    table(
      [
        { title: "Driver", width: 110 }, { title: "Days", width: 30, align: "right" }, { title: "Parcels", width: 44, align: "right" },
        { title: "Stops", width: 40, align: "right" }, { title: "DPD earnings", width: 68, align: "right" }, { title: "Adjustments", width: 62, align: "right" },
        { title: "Final pay", width: 66, align: "right" }, { title: "Expenses", width: 54, align: "right" }, { title: "Vs usual", width: 37, align: "right" },
      ],
      report.drivers.map((d) => [
        `${d.name}${d.registered ? "" : " (not registered)"}${!report.franchiseId ? `\n${d.franchiseLabel}` : ""}`,
        String(d.daysWorked), d.parcelsIncomplete ? `${d.parcels}*` : d.parcels.toLocaleString("en-GB"), d.stopsIncomplete ? `${d.stops}*` : d.stops.toLocaleString("en-GB"),
        money(d.originalEarnings), d.adjustmentsNet === 0 ? "-" : money(d.adjustmentsNet, { signed: true }), money(d.finalEarnings),
        d.fuel + d.otherExpenses === 0 ? "-" : money(d.fuel + d.otherExpenses), changeText(d.comparison.earningsPerDayChange),
      ]),
      {
        fontSize: 8,
        footer: ["Total", "", sum((d) => d.parcels).toLocaleString("en-GB"), sum((d) => d.stops).toLocaleString("en-GB"), money(sum((d) => d.originalEarnings)), money(sum((d) => d.adjustmentsNet), { signed: true }), money(sum((d) => d.finalEarnings)), money(sum((d) => d.fuel + d.otherExpenses)), ""],
      },
    );
    paragraph("“Vs usual” compares average daily earnings with the driver's own average over the previous three months. * = some reports did not include this count.", MUTED);
  }

  // ── Expense breakdown ─────────────────────────────────────────────────────
  heading("Expense breakdown");
  if (report.categories.length === 0) paragraph("No fuel or expenses were recorded for this period.", MUTED);
  else {
    table(
      [{ title: "Category", width: 171 }, { title: "Total", width: 86, align: "right" }, { title: "Attributed to drivers", width: 96, align: "right" }, { title: "Franchise general", width: 86, align: "right" }, { title: "Unallocated", width: 72, align: "right" }],
      report.categories.map((c) => [c.name, money(c.total), money(c.allocatedToDrivers), money(c.franchiseGeneral), money(c.unallocated)]),
      { footer: ["Total", money(t.fuel + t.otherExpenses), money(report.categories.reduce((a, c) => a + c.allocatedToDrivers, 0)), money(report.categories.reduce((a, c) => a + c.franchiseGeneral, 0)), money(t.unallocatedCosts)] },
    );
  }

  // ── Exceptions and adjustments ────────────────────────────────────────────
  heading("Manual adjustments", `${report.adjustments.length} entr${report.adjustments.length === 1 ? "y" : "ies"} this month${report.coverCount ? `, including ${report.coverCount} driver cover record${report.coverCount === 1 ? "" : "s"}` : ""}. Reversed entries are shown with the entry that reverses them.`);
  if (report.adjustments.length === 0) paragraph("No manual adjustments were made.", MUTED);
  else {
    table(
      [{ title: "Date", width: 54 }, { title: "Driver", width: 105 }, { title: "Type", width: 92 }, { title: "Amount", width: 60, align: "right" }, { title: "Reason", width: 200 }],
      report.adjustments.map((a) => [
        formatUkDate(a.date), a.driverName, `${adjustmentLabel(a.type)}${a.isReversal ? " (reversal)" : a.isReversed ? " (reversed)" : ""}`,
        money(a.amount, { signed: true }), a.reason,
      ]),
      { fontSize: 8, footer: ["", "", "Net effect on pay", money(report.adjustments.reduce((s, a) => s + a.amount, 0), { signed: true }), ""] },
    );
  }

  heading("Unusual performance", "Flagged automatically by comparing each driver with their own history. These are prompts to check, not conclusions.");
  if (report.unusual.length === 0) paragraph("Nothing unusual was flagged.", MUTED);
  else {
    table(
      [{ title: "Date", width: 54 }, { title: "What was flagged", width: 237 }, { title: "Actual", width: 70 }, { title: "Usual", width: 90 }, { title: "Status", width: 60 }],
      report.unusual.map((a) => [formatUkDate(a.date), a.title, a.actual ?? "", a.expected ?? "", ANOMALY_STATUS[a.status]?.label ?? a.status]),
      { fontSize: 8 },
    );
  }

  heading("Missing data and unresolved discrepancies");
  if (report.missingData.length === 0 && report.unresolvedImports.length === 0) paragraph("None. All expected reports were received and nothing is waiting to be checked.", MUTED);
  else {
    const rows = [
      ...report.missingData.map((a) => [formatUkDate(a.date), a.title, ANOMALY_STATUS[a.status]?.label ?? a.status]),
      ...report.unresolvedImports.map((r) => [formatUkDate(r.createdAt.slice(0, 10)), r.title, "Waiting to be checked"]),
    ];
    table([{ title: "Date", width: 54 }, { title: "Item", width: 357 }, { title: "Status", width: 100 }], rows, { fontSize: 8 });
    paragraph("Figures in this report may be incomplete until these are dealt with.", MUTED);
  }

  // ── Page footers ──────────────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(`${report.scopeLabel} · ${formatMonth(report.month)}`, MARGIN, PAGE_HEIGHT - MARGIN + 6, { width: CONTENT / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, MARGIN + CONTENT / 2, PAGE_HEIGHT - MARGIN + 6, { width: CONTENT / 2, align: "right", lineBreak: false });
  }
  doc.end();
  return finished;
}
