/**
 * Monthly report PDF (PDFKit). A4 portrait, UK dates and currency.
 * Original DPD figures and manual adjustments are always shown in separate
 * columns, and every revenue or profit figure carries its status.
 */

import PDFDocument from "pdfkit";
import { formatMonth, formatUkDate, formatUkDateTime } from "@/lib/dates";
import { periodLabel } from "@/lib/finance/periods";
import { adjustmentLabel, ANOMALY_STATUS } from "@/lib/labels";
import { formatGBP, type Pence } from "@/lib/money";
import { changeText, type MonthlyReport } from "./monthly";

const INK = "#16191d";
const MUTED = "#66707c";
const LINE = "#cfcbc0";
const BAND = "#f3f1ea";
const GOOD = "#0e5a4e";
const BAD = "#a3261f";
const ACCENT = "#b84700";
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
  // A four-week period report, or a calendar-month report. In route-income mode the imported DPD figures are income and wages come from day rates.
  const routeIncome = report.totals.earningsMeaning === "route_income";
  const kindWord = report.period ? "Period" : "Monthly";
  const periodWord = report.period ? "period" : "month";
  const rangeText = report.period ? periodLabel(report.period) : formatMonth(report.month);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `${kindWord} report ${rangeText} - ${report.scopeLabel}`, Author: report.accountName || "Franchise Books" } });
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
  };
  const paragraph = (text: string, color = INK) => {
    doc.font("Helvetica").fontSize(9.5).fillColor(color);
    const height = doc.heightOfString(text, { width: CONTENT });
    ensure(height + 4);
    doc.text(text, MARGIN, y, { width: CONTENT });
    y += height + 5;
  };
  type Row = string[] | { group: string };
  const table = (columns: Column[], rows: Row[], options: { footer?: string[]; fontSize?: number } = {}) => {
    const size = options.fontSize ?? 8.5;
    let stripe = false;
    const drawGroup = (text: string) => {
      if (y + 40 > PAGE_HEIGHT - MARGIN - 24) { doc.addPage(); y = MARGIN; header(); }
      doc.rect(MARGIN, y + 2, CONTENT, 16).fill(BAND);
      doc.font("Helvetica-Bold").fontSize(size).fillColor(ACCENT).text(text, MARGIN + 4, y + 6, { width: CONTENT - 8, lineBreak: false });
      y += 20;
      stripe = false;
    };
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
      if (stripe && !bold) doc.rect(MARGIN, y, CONTENT, rowHeight).fill("#faf9f5");
      stripe = !stripe;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
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
      const titleH = Math.max(...columns.map((c) => doc.heightOfString(c.title.toUpperCase(), { width: c.width - 6 })));
      let x = MARGIN;
      for (const column of columns) {
        doc.text(column.title.toUpperCase(), x + 3, y + 2, { width: column.width - 6, align: column.align ?? "left" });
        x += column.width;
      }
      y += titleH + 8;
      doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT, y).lineWidth(0.8).strokeColor(LINE).stroke();
    };
    ensure(40);
    header();
    for (const row of rows) { if (Array.isArray(row)) drawRow(row, false, INK); else drawGroup(row.group); }
    if (options.footer) drawRow(options.footer, true, INK);
    y += 8;
  };

  // ── Title block ───────────────────────────────────────────────────────────
  doc.rect(0, 0, PAGE_WIDTH, 6).fill(ACCENT);
  y = MARGIN + 4;
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text((report.accountName || "Franchise Books").toUpperCase(), MARGIN, y, { characterSpacing: 0.6 });
  y += 15;
  doc.font("Helvetica-Bold").fontSize(21).fillColor(INK).text(`${kindWord} report: ${rangeText}`, MARGIN, y);
  y += 28;
  doc.font("Helvetica").fontSize(11).fillColor(INK).text(report.scopeLabel, MARGIN, y);
  y += 16;
  doc.fontSize(8.5).fillColor(MUTED).text(`${formatUkDate(report.from)} to ${formatUkDate(report.to)}   |   Generated ${formatUkDateTime(report.generatedAt)}`, MARGIN, y);
  y += 16;

  // ── At a glance ───────────────────────────────────────────────────────────
  const t = report.totals;
  // Money out is shown in brackets, and a loss is a bracketed figure, as on the dashboard.
  const bracket = (pence: Pence) => (pence < 0 ? `(${money(-pence)})` : money(pence));
  const profitText = t.operatingProfit == null ? "Not available" : money(t.operatingProfit);
  const profitColor = t.operatingProfit == null ? MUTED : t.operatingProfit < 0 ? BAD : GOOD;
  // Route income: income, the costs before and after VAT, and profit or loss before and after VAT. Wages are counted at £0 where
  // a driver has no day rate, and that is said beside them.
  const income = t.revenueTotal;
  const costsBefore = t.wages + t.fuel + t.otherExpenses;
  const costsWith = costsBefore + report.vatOnCosts;
  const profitBefore = income - costsBefore;
  const profitWith = income - costsWith;
  const cards: { label: string; value: string; sub: string; color: string }[] = routeIncome ? [
    { label: "INCOME FROM DPD", value: money(income), sub: "payments to you", color: GOOD },
    { label: "COSTS BEFORE VAT", value: bracket(-costsBefore), sub: "wages, fuel and other", color: BAD },
    { label: "PROFIT / (LOSS)", value: bracket(profitBefore), sub: t.wagesComplete ? "before VAT" : "before VAT, wages incomplete", color: profitBefore < 0 ? BAD : GOOD },
    { label: "PROFIT / (LOSS)", value: bracket(profitWith), sub: "with VAT on costs", color: profitWith < 0 ? BAD : GOOD },
  ] : [
    { label: "REVENUE", value: t.revenueStatus === "unavailable" ? "Not entered" : money(t.revenueTotal), sub: STATUS_TEXT[t.revenueStatus]!, color: INK },
    { label: "DRIVER COSTS", value: money(t.driverCosts), sub: "pay after adjustments", color: INK },
    { label: "EXPENSES", value: money(t.fuel + t.otherExpenses), sub: "fuel and other", color: INK },
    { label: "PROFIT", value: profitText, sub: t.operatingProfit == null ? "revenue not entered" : t.marginPercent == null ? "" : `${t.marginPercent}% margin`, color: profitColor },
  ];
  heading("At a glance");
  const gap = 8;
  const cardW = (CONTENT - gap * 3) / 4;
  ensure(64);
  cards.forEach((c, i) => {
    const x = MARGIN + i * (cardW + gap);
    doc.roundedRect(x, y, cardW, 56, 4).lineWidth(0.8).fillAndStroke(i === 3 ? BAND : "#ffffff", LINE);
    doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text(c.label, x + 9, y + 8, { width: cardW - 18, lineBreak: false, characterSpacing: 0.5 });
    doc.font("Helvetica-Bold").fontSize(c.value.length > 11 ? 12.5 : 15).fillColor(c.color).text(c.value, x + 9, y + 21, { width: cardW - 18, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(c.sub, x + 9, y + 42, { width: cardW - 18, lineBreak: false });
  });
  y += 68;

  // The working behind the cards, as a simple statement that reads top to bottom.
  const stopPay = t.incomeFromDpd - t.otherDpdPayments;
  type StatementLine = { label: string; value: string; note?: string; bold?: boolean; band?: boolean; indent?: boolean; color?: string };
  const incomplete = t.driversMissingRate;
  const statementRows: StatementLine[] = routeIncome ? [
    { label: "Stop pay from DPD", value: money(stopPay), note: "from the daily payment reports", indent: true },
    ...(t.otherDpdPayments > 0 ? [{ label: "Other DPD payments", value: money(t.otherDpdPayments), note: otherPaymentsNote(report.otherPayments), indent: true }] : []),
    { label: "Income", value: money(income), bold: true, color: GOOD },
    { label: "Driver wages", value: bracket(-t.wages), note: t.wagesComplete ? undefined : `${incomplete} driver${incomplete === 1 ? " has" : "s have"} no day rate, counted at £0`, indent: true, color: BAD },
    { label: "Fuel", value: bracket(-t.fuel), indent: true, color: BAD },
    { label: "Other expenses", value: bracket(-t.otherExpenses), indent: true, color: BAD },
    { label: "Costs before VAT", value: bracket(-costsBefore), bold: true, color: BAD },
    { label: "VAT on costs", value: bracket(-report.vatOnCosts), note: "as stated on the documents", indent: true, color: BAD },
    { label: "Costs with VAT", value: bracket(-costsWith), bold: true, color: BAD },
    { label: "Profit / (Loss) before VAT", value: bracket(profitBefore), bold: true, band: true, color: profitBefore < 0 ? BAD : GOOD },
    { label: "Profit / (Loss) with VAT", value: bracket(profitWith), bold: true, color: profitWith < 0 ? BAD : GOOD },
  ] : [
    { label: "Revenue", value: t.revenueStatus === "unavailable" ? "Not entered" : money(t.revenueTotal), note: STATUS_TEXT[t.revenueStatus]!, bold: true },
    { label: "less Driver costs (pay after adjustments)", value: money(t.driverCosts), indent: true },
    { label: "original DPD earnings", value: money(t.driverOriginalEarnings), note: "from DPD documents", indent: true },
    { label: "manual adjustments", value: money(t.driverAdjustmentsNet, { signed: true }), note: "entered by hand", indent: true },
    { label: "less Fuel", value: money(t.fuel), indent: true },
    { label: "less Other expenses", value: money(t.otherExpenses), indent: true },
    { label: "Operating profit", value: profitText, note: t.operatingProfit == null ? "revenue not entered" : STATUS_TEXT[t.profitStatus]!, bold: true, band: true },
  ];
  for (const row of statementRows) {
    const x = MARGIN + (row.indent ? 14 : 0);
    const noteH = row.note ? doc.font("Helvetica").fontSize(8.5).heightOfString(row.note, { width: CONTENT - 380 }) : 0;
    const rowH = Math.max(17, noteH + 5);
    ensure(rowH + 2);
    if (row.band) doc.rect(MARGIN, y - 2, CONTENT, rowH + 2).fill(BAND);
    doc.font(row.bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK).text(row.label, x + 6, y, { width: 240 });
    doc.font(row.bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(row.color ?? INK).text(row.value, MARGIN + 250, y, { width: 116, align: "right", lineBreak: false });
    if (row.note) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(row.note, MARGIN + 380, y + 1, { width: CONTENT - 380 });
    y += rowH;
  }
  y += 4;
  if (routeIncome) {
    if (!t.wagesComplete) {
      paragraph(`Wages are incomplete: ${t.driversMissingRate} driver${t.driversMissingRate === 1 ? "" : "s"} worked days with no day rate set. Their wages are counted at £0, so the profit shown is before those wages are added. Set day rates under Drivers to complete it.`, MUTED);
    }
  } else if (t.revenueStatus === "unavailable") {
    paragraph("No revenue has been entered for this period, so profit cannot be reported. Driver earnings are a cost and are never treated as revenue.", MUTED);
  } else if (t.revenueStatus === "estimated") {
    paragraph("Revenue includes at least one estimated entry, so profit and margin are estimates.", MUTED);
  }
  paragraph(`${t.driverCount} driver${t.driverCount === 1 ? "" : "s"} worked, completing ${t.stops.toLocaleString("en-GB")} stops and ${t.parcels.toLocaleString("en-GB")} parcels.`, MUTED);

  if (!report.franchiseId && report.franchises.length > 1 && routeIncome) {
    heading("By franchise");
    table(
      [{ title: "Franchise", width: 151 }, { title: "Income", width: 90, align: "right" }, { title: "Wages", width: 90, align: "right" }, { title: "Costs", width: 90, align: "right" }, { title: "Profit / (Loss)", width: 90, align: "right" }],
      report.franchises.map((f) => {
        const profit = f.incomeFromDpd - f.wages - f.fuel - f.otherExpenses;
        return [f.label + (f.wagesComplete ? "" : " *"), money(f.incomeFromDpd), bracket(-f.wages), bracket(-(f.fuel + f.otherExpenses)), bracket(profit)];
      }),
      { footer: ["Total", money(t.revenueTotal), bracket(-t.wages), bracket(-(t.fuel + t.otherExpenses)), bracket(profitBefore)] },
    );
    if (!t.wagesComplete) paragraph("* A franchise marked with an asterisk has drivers with no day rate. Their wages are counted at £0 until a day rate is set.", MUTED);
  } else if (!report.franchiseId && report.franchises.length > 1) {
    heading("By franchise");
    table(
      [{ title: "Franchise", width: 151 }, { title: "Revenue", width: 76, align: "right" }, { title: "Driver Costs", width: 76, align: "right" }, { title: "Fuel", width: 66, align: "right" }, { title: "Other", width: 66, align: "right" }, { title: "Profit", width: 76, align: "right" }],
      report.franchises.map((f) => [
        f.label, f.revenueStatus === "unavailable" ? "Not entered" : `${money(f.revenueTotal)}${f.revenueStatus === "estimated" ? " (est.)" : ""}`,
        money(f.driverCosts), money(f.fuel), money(f.otherExpenses),
        f.operatingProfit == null ? "n/a" : `${money(f.operatingProfit)}${f.profitStatus === "estimated" ? " (est.)" : ""}`,
      ]),
    );
  }

  // ── Driver breakdown ──────────────────────────────────────────────────────
  heading("Driver breakdown", routeIncome ? "“Income” is what DPD paid for each driver's routes. “Wage” is the day rate for each day worked, plus any adjustments; “no rate” means no day rate is set. Where a driver ran more than one route, the route numbers are separated by a slash." : "“DPD earnings” are the original figures from DPD documents. “Adjustments” are manual entries. “Final pay” is the two added together.");
  const withGroups = <T extends { franchiseLabel: string }>(list: T[], build: (d: T) => string[]): Row[] => {
    const rows: Row[] = [];
    let last = "";
    for (const d of list) {
      if (!report.franchiseId && d.franchiseLabel !== last) { rows.push({ group: d.franchiseLabel }); last = d.franchiseLabel; }
      rows.push(build(d));
    }
    return rows;
  };
  const routesText = (d: { routes: string[] }) => (d.routes.length ? d.routes.join(" / ") : "-");
  if (report.drivers.length === 0) paragraph("No driver earnings were recorded for this period.", MUTED);
  else if (routeIncome) {
    const worked = report.drivers.filter((d) => d.daysWorked > 0);
    const incomeSum = worked.reduce((a, d) => a + d.originalEarnings, 0);
    const wageSum = worked.reduce((a, d) => a + (d.wage ?? 0), 0);
    const driverProfit = (d: MonthlyReport["drivers"][number]) => d.originalEarnings - (d.wage ?? 0);
    table(
      [
        { title: "Driver", width: 88 }, { title: "Route", width: 44 }, { title: "Days", width: 26, align: "right" }, { title: "Stops", width: 38, align: "right" }, { title: "Parcels", width: 46, align: "right" },
        { title: "Income", width: 64, align: "right" }, { title: "Per Stop", width: 40, align: "right" }, { title: "Wage", width: 64, align: "right" }, { title: "Profit / (Loss)", width: 64, align: "right" }, { title: "Vs Usual", width: 37, align: "right" },
      ],
      withGroups(worked, (d) => [
        `${d.name}${d.registered ? "" : " (not registered)"}`, routesText(d),
        String(d.daysWorked), d.stopsIncomplete ? `${d.stops}*` : d.stops.toLocaleString("en-GB"), d.parcelsIncomplete ? `${d.parcels}*` : d.parcels.toLocaleString("en-GB"),
        money(d.originalEarnings), d.stopsIncomplete ? "-" : money(d.earningsPerStop), d.wageComplete && d.wage != null ? money(d.wage) : "no rate",
        bracket(driverProfit(d)), changeText(d.comparison.earningsPerDayChange),
      ]),
      { fontSize: 8, footer: ["Total", "", "", worked.reduce((a, d) => a + d.stops, 0).toLocaleString("en-GB"), worked.reduce((a, d) => a + d.parcels, 0).toLocaleString("en-GB"), money(incomeSum), "", money(wageSum), bracket(incomeSum - wageSum), ""] },
    );
    paragraph("“Vs usual” compares average daily income with the driver's own average over the previous three periods. * = some reports did not include this count. Profit / (Loss) is income less wage for each driver. Costs such as fuel are not shared out between drivers.", MUTED);
  } else {
    const sum = (pick: (d: MonthlyReport["drivers"][number]) => number) => report.drivers.reduce((a, d) => a + pick(d), 0);
    table(
      [
        { title: "Driver", width: 100 }, { title: "Route", width: 46 }, { title: "Days", width: 26, align: "right" }, { title: "Parcels", width: 40, align: "right" },
        { title: "Stops", width: 36, align: "right" }, { title: "DPD Earnings", width: 62, align: "right" }, { title: "Adjust.", width: 50, align: "right" },
        { title: "Final Pay", width: 62, align: "right" }, { title: "Expenses", width: 52, align: "right" }, { title: "Vs Usual", width: 37, align: "right" },
      ],
      withGroups(report.drivers, (d) => [
        `${d.name}${d.registered ? "" : " (not registered)"}`, routesText(d),
        String(d.daysWorked), d.parcelsIncomplete ? `${d.parcels}*` : d.parcels.toLocaleString("en-GB"), d.stopsIncomplete ? `${d.stops}*` : d.stops.toLocaleString("en-GB"),
        money(d.originalEarnings), d.adjustmentsNet === 0 ? "-" : money(d.adjustmentsNet, { signed: true }), money(d.finalEarnings),
        d.fuel + d.otherExpenses === 0 ? "-" : money(d.fuel + d.otherExpenses), changeText(d.comparison.earningsPerDayChange),
      ]),
      {
        fontSize: 8,
        footer: ["Total", "", "", sum((d) => d.parcels).toLocaleString("en-GB"), sum((d) => d.stops).toLocaleString("en-GB"), money(sum((d) => d.originalEarnings)), money(sum((d) => d.adjustmentsNet), { signed: true }), money(sum((d) => d.finalEarnings)), money(sum((d) => d.fuel + d.otherExpenses)), ""],
      },
    );
    paragraph("“Vs usual” compares average daily earnings with the driver's own average over the previous three months. * = some reports did not include this count.", MUTED);
  }

  // ── Driver day by day ─────────────────────────────────────────────────────
  const daily = report.dailyPayments ?? [];
  if (daily.length > 0) {
    heading("Driver day by day", "Each day as DPD shows it on the Payments page: stops, parcels, what they paid, route and mileage. A dash means that detail was not recorded.");
    const dash = (n: number | null) => (n == null ? "-" : n.toLocaleString("en-GB"));
    const dailyRows: Row[] = [];
    let lastGroup = "";
    for (const d of daily) {
      const group = `${d.driverName}${report.franchiseId ? "" : ` - ${d.franchiseLabel}`}`;
      if (group !== lastGroup) { dailyRows.push({ group }); lastGroup = group; }
      dailyRows.push([formatUkDate(d.date), d.route ?? "-", dash(d.stops), dash(d.parcels), dash(d.excessParcels), d.stopPay == null ? "-" : money(d.stopPay), d.parcelPay == null ? "-" : money(d.parcelPay), money(d.total), dash(d.mileage)]);
    }
    table(
      [
        { title: "Date", width: 80 }, { title: "Route", width: 48 }, { title: "Stops", width: 40, align: "right" }, { title: "Parcels", width: 46, align: "right" }, { title: "Excess", width: 44, align: "right" },
        { title: "Stop Pay", width: 68, align: "right" }, { title: "Parcel Pay", width: 62, align: "right" }, { title: "Total", width: 72, align: "right" }, { title: "Miles", width: 40, align: "right" },
      ],
      dailyRows,
      { fontSize: 8 },
    );
  }

  // ── Expense breakdown ─────────────────────────────────────────────────────
  heading("Expense breakdown");
  if (report.categories.length === 0) paragraph("No fuel or expenses were recorded for this period.", MUTED);
  else {
    table(
      [{ title: "Category", width: 171 }, { title: "Total", width: 86, align: "right" }, { title: "To Drivers", width: 96, align: "right" }, { title: "Franchise", width: 86, align: "right" }, { title: "Unallocated", width: 72, align: "right" }],
      report.categories.map((c) => [c.name, money(c.total), money(c.allocatedToDrivers), money(c.franchiseGeneral), money(c.unallocated)]),
      { footer: ["Total", money(t.fuel + t.otherExpenses), money(report.categories.reduce((a, c) => a + c.allocatedToDrivers, 0)), money(report.categories.reduce((a, c) => a + c.franchiseGeneral, 0)), money(t.unallocatedCosts)] },
    );
  }

  // ── Exceptions and adjustments ────────────────────────────────────────────
  heading("Manual adjustments", `${report.adjustments.length} entr${report.adjustments.length === 1 ? "y" : "ies"} this ${periodWord}${report.coverCount ? `, including ${report.coverCount} driver cover record${report.coverCount === 1 ? "" : "s"}` : ""}. Reversed entries are shown with the entry that reverses them.`);
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
      [{ title: "Date", width: 54 }, { title: "What Was Flagged", width: 237 }, { title: "Actual", width: 70 }, { title: "Usual", width: 90 }, { title: "Status", width: 60 }],
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
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(`${report.scopeLabel} · ${rangeText}`, MARGIN, PAGE_HEIGHT - MARGIN + 6, { width: CONTENT / 2, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, MARGIN + CONTENT / 2, PAGE_HEIGHT - MARGIN + 6, { width: CONTENT / 2, align: "right", lineBreak: false });
  }
  doc.end();
  return finished;
}

/** What the "Other DPD payments" line is made of, in a few words: "Fuel Supplement, C&D App, DPD business start support payment". */
export function otherPaymentsNote(payments: MonthlyReport["otherPayments"]): string {
  if (!payments?.length) return "Fuel Supplement, C&D App";
  const labels = [...new Set(payments.map((p) => p.label))];
  const text = labels.join(", ");
  return text.length > 70 ? `${text.slice(0, 67)}...` : text;
}
