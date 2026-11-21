import "server-only";
import { fetchAll } from "@/lib/data/fetch-all";
import { loadPeriodData } from "@/lib/data/period";
import { formatUkDate } from "@/lib/dates";
import { buildDiscrepancyReport, NOT_COMPARED_TEXT, routeRows, type DayOutcome, type DiscrepancyReport } from "@/lib/finance/discrepancy";
import { buildDriverStatement, type DriverStatement } from "@/lib/finance/driver-view";
import { periodLabel, type DpdPeriod } from "@/lib/finance/periods";
import { formatPortalDate } from "@/lib/finance/scale-grid";
import { loadScaleGrid, scaleSummary } from "@/lib/finance/scale-library";
import { normaliseFuel } from "@/lib/finance/sliding-scale";
import { rateOn } from "@/lib/finance/wages";
import { formatGBP, toDb, type Pence } from "@/lib/money";
import type { AdminClient } from "@/lib/supabase/admin";
import { csvMoney, toCsv } from "./csv";
import { buildMonthlyReport } from "./monthly";
import { BAD, GOOD, MUTED, createReportKit, money, type Row } from "./pdf-kit";

/**
 * The three end-of-period reports. Each is built from stated figures only: nothing is estimated, and a figure that cannot be
 * read is flagged instead of being filled in.
 */

export type ExtraReportKind = "driver_pay" | "profit_loss" | "discrepancy";

export const REPORT_KIND_LABEL: Record<"period" | ExtraReportKind, string> = {
  period: "Period Report",
  driver_pay: "Driver Pay Report",
  profit_loss: "Profit and Loss",
  discrepancy: "Sliding Scale Discrepancy",
};

export interface BuiltReport {
  pdf: Buffer;
  /** Only the discrepancy report has a CSV. */
  csv?: string;
  scopeLabel: string;
  /** Stored with the report row; the Reports page shows `summary`. */
  totals: Record<string, unknown>;
}

interface Scope { accountName: string; scopeLabel: string; labels: Map<string, string>; franchiseIds: string[] }

async function loadScope(db: AdminClient, accountId: string, franchiseId: string | null): Promise<Scope> {
  const [account, franchises] = await Promise.all([
    db.from("accounts").select("name").eq("id", accountId).maybeSingle(),
    fetchAll(() => db.from("franchises").select("id, fd_number, name").eq("account_id", accountId).order("fd_number")),
  ]);
  const labels = new Map(franchises.map((f) => [f.id, f.name && f.name !== f.fd_number ? `${f.fd_number} · ${f.name}` : f.fd_number]));
  return {
    accountName: account.data?.name ?? "",
    scopeLabel: franchiseId ? (labels.get(franchiseId) ?? "Franchise") : "All franchises (consolidated)",
    labels,
    franchiseIds: franchiseId ? [franchiseId] : franchises.map((f) => f.id),
  };
}

// ── Driver Pay Report ───────────────────────────────────────────────────────

export interface DriverPayLine {
  driverId: string;
  name: string;
  franchiseLabel: string;
  /** How many FD numbers this driver worked under in the period. */
  franchiseCount: number;
  rateText: string;
  statement: DriverStatement;
  base: Pence;
  extra: Pence;
  runDays: number;
}

/** Every driver's pay for the period, one line per person across all their FD numbers, as the Driver Pay Report states it. */
export async function loadDriverPayLines(db: AdminClient, input: { accountId: string; franchiseId: string | null; period: DpdPeriod }): Promise<{ lines: DriverPayLine[]; complete: boolean; owed: Pence; dr: Map<string, string | null> }> {
  const { accountId, franchiseId, period } = input;
  const scope = await loadScope(db, accountId, franchiseId);
  const data = await loadPeriodData(db, { accountId, from: period.start, to: period.end, franchiseId });
  // The franchisee is not paid a day rate, so is not on the pay report. Read on its own so a missing column cannot stop the report.
  const flags = await db.from("drivers").select("id, is_franchisee, dpd_driver_ref").eq("account_id", accountId);
  const franchisee = new Set(flags.error ? [] : (flags.data ?? []).filter((d) => d.is_franchisee).map((d) => d.id));
  const dr = new Map((flags.error ? [] : (flags.data ?? [])).map((d) => [d.id, d.dpd_driver_ref ?? null] as const));
  const dayRates = data.dayRates ?? [];

  const byDriver = new Map<string, { franchiseId: string; earnings: typeof data.earnings }>();
  for (const e of data.earnings) {
    if (!e.driverId || franchisee.has(e.driverId)) continue;
    const entry = byDriver.get(e.driverId) ?? { franchiseId: e.franchiseId, earnings: [] };
    entry.earnings.push(e);
    byDriver.set(e.driverId, entry);
  }
  const lines: DriverPayLine[] = [...byDriver.entries()].map(([driverId, { franchiseId: fid, earnings }]) => {
    const statement = buildDriverStatement({ driverId, earnings, adjustments: data.adjustments.filter((a) => a.driverId === driverId), dayRates, workedBefore: data.workedBefore?.get(driverId) ?? [] });
    const last = statement.days.at(-1)?.date;
    const rate = last ? rateOn(dayRates, driverId, last) : null;
    const rateText = !rate ? "No rate set" : (rate.basis ?? "day") === "stop" ? `${formatGBP(rate.dayRate)} a stop` : `${formatGBP(rate.dayRate)} a day`;
    return {
      driverId, name: data.driverNames.get(driverId) ?? "Unknown driver", franchiseLabel: scope.labels.get(fid) ?? "", franchiseCount: new Set(earnings.map((e) => e.franchiseId)).size, rateText, statement,
      base: statement.days.reduce((a, d) => a + (d.breakdown?.base ?? 0), 0),
      extra: statement.days.reduce((a, d) => a + (d.breakdown?.extra ?? 0), 0),
      runDays: statement.days.filter((d) => d.breakdown?.runRate).length,
    };
  }).sort((a, b) => a.franchiseLabel.localeCompare(b.franchiseLabel) || a.name.localeCompare(b.name, "en-GB"));

  // Only drivers who did at least one route in the period are paid on this report.
  const worked = lines.filter((l) => l.statement.daysWorked >= 1);
  const complete = worked.every((l) => l.statement.unpricedDates.length === 0);
  const owed = worked.reduce((a, l) => a + l.statement.total, 0);
  return { lines: worked, complete, owed, dr };
}

/** One line per driver for Wages to Pay: the consolidated pay, with an incomplete driver's amount marked. */
export interface WagesLine {
  driverId: string;
  dr: string | null;
  name: string;
  franchises: number;
  /** Amount owed. Days that could not be priced are not counted, so this is never guessed. */
  total: Pence;
  complete: boolean;
}

export function wagesLinesFrom(lines: DriverPayLine[], dr: Map<string, string | null>): WagesLine[] {
  return lines.map((l) => ({
    driverId: l.driverId,
    dr: dr.get(l.driverId) ?? null,
    name: l.name,
    franchises: l.franchiseCount,
    total: l.statement.total,
    complete: l.statement.unpricedDates.length === 0,
  }));
}

export async function buildDriverPayReport(db: AdminClient, input: { accountId: string; franchiseId: string | null; period: DpdPeriod }): Promise<BuiltReport> {
  const { accountId, franchiseId, period } = input;
  const scope = await loadScope(db, accountId, franchiseId);
  const { lines, complete, owed } = await loadDriverPayLines(db, { accountId, franchiseId, period });
  const plus = (v: string, ok: boolean) => (ok ? v : `${v} +`);

  const generatedAt = new Date().toISOString();
  const kit = createReportKit({ title: `Driver pay report ${periodLabel(period)} - ${scope.scopeLabel}`, author: scope.accountName });
  kit.title({ account: scope.accountName, heading: "Driver Pay Report", scope: scope.scopeLabel, line: `Period ${formatUkDate(period.start)} to ${formatUkDate(period.end)}`, generatedAt });
  kit.heading("Pay Owed", "What each driver is owed for the period, from the pay rates set under Drivers and the days DPD paid for. Adjustments are manual entries.");
  if (lines.length === 0) kit.paragraph("No driver worked in this period.", MUTED);
  else {
    const group = (list: DriverPayLine[], build: (l: DriverPayLine) => string[]): Row[] => {
      const rows: Row[] = [];
      let last = "";
      for (const l of list) {
        if (!franchiseId && l.franchiseLabel !== last) { rows.push({ group: l.franchiseLabel }); last = l.franchiseLabel; }
        rows.push(build(l));
      }
      return rows;
    };
    kit.table(
      [
        { title: "Driver", width: 100 }, { title: "Rate", width: 62 }, { title: "Days", width: 26, align: "right" }, { title: "Stops", width: 38, align: "right" },
        { title: "Base Pay", width: 58, align: "right" }, { title: "Extra Pay", width: 52, align: "right" }, { title: "In a Row", width: 38, align: "right" },
        { title: "Adjust.", width: 52, align: "right" }, { title: "Total Owed", width: 87, align: "right" },
      ],
      group(lines, (l) => {
        const s = l.statement;
        const ok = s.unpricedDates.length === 0;
        return [l.name, l.rateText, String(s.daysWorked), s.stops.toLocaleString("en-GB"), money(l.base), l.extra === 0 ? "-" : money(l.extra), l.runDays === 0 ? "-" : `${l.runDays} d`,
          s.adjustmentsNet === 0 ? "-" : money(s.adjustmentsNet, { signed: true }), plus(money(s.total), ok)];
      }),
      { fontSize: 8, footer: ["Total", "", String(lines.reduce((a, l) => a + l.statement.daysWorked, 0)), lines.reduce((a, l) => a + l.statement.stops, 0).toLocaleString("en-GB"), money(lines.reduce((a, l) => a + l.base, 0)), money(lines.reduce((a, l) => a + l.extra, 0)), "", lines.every((l) => l.statement.adjustmentsNet === 0) ? "-" : money(lines.reduce((a, l) => a + l.statement.adjustmentsNet, 0), { signed: true }), plus(money(owed), complete)] },
    );
    kit.paragraph("Base Pay is the day rate (the days-in-a-row rate on those days). Extra Pay is for stops over the driver's threshold. In a Row is the number of days paid at the days-in-a-row rate.", MUTED);
    if (!complete) {
      const names = lines.filter((l) => l.statement.unpricedDates.length > 0).map((l) => `${l.name} (${l.statement.unpricedDates.length} day${l.statement.unpricedDates.length === 1 ? "" : "s"})`).join(", ");
      kit.paragraph(`Some days could not be priced, so the totals marked + are incomplete: ${names}. A day needs a pay rate, and a stop count where the rate pays per stop. Nothing has been estimated.`, BAD);
    }

    kit.heading("Day by Day", "How each day was worked out.");
    const dayRows: Row[] = [];
    for (const l of lines) {
      dayRows.push({ group: `${l.name}${franchiseId ? "" : ` - ${l.franchiseLabel}`}` });
      for (const d of l.statement.days) {
        dayRows.push([formatUkDate(d.date), d.route ?? "-", d.stops == null ? "-" : String(d.stops), d.pay == null ? "Not priced" : money(d.pay), d.workings ?? (d.pay == null ? "No rate or stop count" : "")]);
      }
      for (const a of l.statement.adjustments) dayRows.push([formatUkDate(a.date), "", "", money(a.amount, { signed: true }), `${a.label}${a.reversal ? " (reversal)" : ""}: ${a.reason}`]);
    }
    kit.table([{ title: "Date", width: 70 }, { title: "Route", width: 60 }, { title: "Stops", width: 40, align: "right" }, { title: "Pay", width: 72, align: "right" }, { title: "Working", width: 269 }], dayRows, { fontSize: 8 });
  }
  const pdf = await kit.finish(`${scope.scopeLabel} · Driver Pay Report`);
  return {
    pdf, scopeLabel: scope.scopeLabel,
    totals: { scopeLabel: scope.scopeLabel, summary: `${plus(formatGBP(owed), complete)} owed to ${lines.length} driver${lines.length === 1 ? "" : "s"}`, totalOwed: toDb(owed), drivers: lines.length, complete },
  };
}

// ── Profit and Loss ─────────────────────────────────────────────────────────

export async function buildProfitLossReport(db: AdminClient, input: { accountId: string; franchiseId: string | null; period: DpdPeriod; month: string }): Promise<BuiltReport> {
  const report = await buildMonthlyReport(db, { accountId: input.accountId, month: input.month, franchiseId: input.franchiseId, period: input.period });
  const t = report.totals;
  const period = input.period;
  // Money out is in brackets, and a loss is a bracketed figure, as on the dashboard and the period report.
  const bracket = (pence: number) => (pence < 0 ? `(${money(-pence)})` : money(pence));
  const unavailable = t.revenueStatus === "unavailable";
  const stopPay = t.incomeFromDpd - t.otherDpdPayments;
  const incomeNum = unavailable ? 0 : t.revenueTotal;
  const costsBefore = t.wages + t.fuel + t.otherExpenses;
  const costsWith = costsBefore + report.vatOnCosts;
  const profitBefore = incomeNum - costsBefore;
  const profitWith = incomeNum - costsWith;
  const incompleteDrivers = t.driversMissingRate;
  const profitTone = (n: number) => (n < 0 ? BAD : GOOD);

  const kit = createReportKit({ title: `Profit and loss ${periodLabel(period)} - ${report.scopeLabel}`, author: report.accountName });
  kit.title({ account: report.accountName, heading: "Profit and Loss", scope: report.scopeLabel, line: `Period ${formatUkDate(period.start)} to ${formatUkDate(period.end)}`, generatedAt: report.generatedAt });
  kit.heading("Profit and Loss", "Income is what DPD stated it paid. Costs are the driver wages, fuel and other expenses stated on the documents, with the VAT on them as stated. Driver wages come from the pay rates set under Drivers. A driver with no day rate is counted at £0 and marked.");
  kit.line("Stop pay from DPD", money(stopPay), "from the daily payment reports", false, { indent: true });
  if (t.otherDpdPayments > 0) kit.line("Other DPD payments", money(t.otherDpdPayments), (report.otherPayments ?? []).map((p) => p.label).filter((v, i, a) => a.indexOf(v) === i).join(", "), false, { indent: true });
  kit.line("Income", unavailable ? "None" : money(incomeNum), "", true, { color: GOOD });
  kit.line("Driver wages", bracket(-t.wages), t.wagesComplete ? "" : `${incompleteDrivers} driver${incompleteDrivers === 1 ? " has" : "s have"} no day rate, counted at £0`, false, { indent: true, color: BAD });
  kit.line("Fuel", bracket(-t.fuel), "", false, { indent: true, color: BAD });
  kit.line("Other expenses", bracket(-t.otherExpenses), "", false, { indent: true, color: BAD });
  kit.line("Costs before VAT", bracket(-costsBefore), "", true, { color: BAD });
  kit.line("VAT on costs", bracket(-report.vatOnCosts), "as stated on the documents", false, { indent: true, color: BAD });
  kit.line("Costs with VAT", bracket(-costsWith), "", true, { color: BAD });
  kit.line("Profit / (Loss) before VAT", unavailable ? "None" : bracket(profitBefore), t.wagesComplete ? "headline figure" : "wages incomplete", true, { color: profitTone(profitBefore) });
  kit.line("Profit / (Loss) with VAT", unavailable ? "None" : bracket(profitWith), "after VAT on costs", true, { color: profitTone(profitWith) });
  if (!t.wagesComplete) kit.paragraph(`${incompleteDrivers} driver${incompleteDrivers === 1 ? " has" : "s have"} worked days with no day rate set. Their wages are counted at £0, so the profit above is before those wages. Set day rates under Drivers to complete it.`, MUTED);

  if (!input.franchiseId && report.franchises.length > 1) {
    kit.heading("By Franchise");
    const franchiseRows: Row[] = report.franchises.map((f) => {
      const costs = f.fuel + f.otherExpenses;
      return [f.label + (f.wagesComplete ? "" : " *"), money(f.incomeFromDpd), bracket(-f.wages), bracket(-costs), bracket(f.incomeFromDpd - f.wages - costs)];
    });
    kit.table(
      [{ title: "Franchise", width: 151 }, { title: "Income", width: 90, align: "right" }, { title: "Wages", width: 90, align: "right" }, { title: "Costs", width: 90, align: "right" }, { title: "Profit / (Loss)", width: 90, align: "right" }],
      franchiseRows,
      { footer: ["Total", money(incomeNum), bracket(-t.wages), bracket(-(t.fuel + t.otherExpenses)), bracket(profitBefore)] },
    );
    if (!t.wagesComplete) kit.paragraph("* A franchise marked with an asterisk has drivers with no day rate. Their wages are counted at £0 until a day rate is set.", MUTED);
  }
  kit.heading("Expense Breakdown", "Driver wages are a cost, so they are listed first. VAT is what each document states.");
  const categoryRows: Row[] = [
    ["Driver wages", money(t.wages), "-"],
    ...report.categories.map((c): string[] => [c.name, money(c.total), c.vat ? money(c.vat) : "-"]),
  ];
  kit.table([{ title: "Category", width: 311 }, { title: "Amount", width: 100, align: "right" }, { title: "VAT Stated", width: 100, align: "right" }], categoryRows,
    { footer: ["Total", money(costsBefore), money(report.vatOnCosts)] });
  const pdf = await kit.finish(`${report.scopeLabel} · Profit and Loss`);
  return {
    pdf, scopeLabel: report.scopeLabel,
    totals: {
      scopeLabel: report.scopeLabel, summary: `Profit / (loss) before VAT ${bracket(profitBefore)}`,
      revenue: t.revenueStatus === "unavailable" ? null : toDb(t.revenueTotal), revenueStatus: t.revenueStatus, driverCosts: toDb(t.driverCosts), fuel: toDb(t.fuel), otherExpenses: toDb(t.otherExpenses),
      operatingProfit: toDb(profitBefore), profitWithVat: toDb(profitWith), vatOnCosts: toDb(report.vatOnCosts), profitStatus: t.profitStatus, earningsMeaning: t.earningsMeaning, wagesComplete: t.wagesComplete,
    },
  };
}

// ── Sliding Scale Discrepancy ───────────────────────────────────────────────

export function discrepancyCsv(outcomes: DayOutcome[]): string {
  return toCsv(
    ["Date", "Driver and Route", "Stops", "Paid Per Stop", "Scale Per Stop", "Difference", "Result", "Note"],
    outcomes.map((o) => {
      if (o.kind === "not_compared") return [o.date, o.label ?? "", o.stops ?? "", o.paidPerStop != null ? o.paidPerStop.toFixed(2) : "", o.guideRate != null ? o.guideRate.toFixed(2) : "", "", "Not compared", NOT_COMPARED_TEXT[o.reason]];
      return [o.date, o.label ?? "", o.stops, o.paidPerStop.toFixed(2), o.expectedPerStop.toFixed(2), o.kind === "agrees" ? "" : csvMoney(o.differencePence), o.kind === "agrees" ? "Agrees" : o.kind === "underpaid" ? "Underpaid" : "Overpaid", ""];
    }),
  );
}

/** Null when the franchise has no sliding scale chosen, so there is nothing to check against. */
export async function buildDiscrepancyPdfReport(db: AdminClient, input: { accountId: string; franchiseId: string; period: DpdPeriod }): Promise<BuiltReport | null> {
  const { accountId, franchiseId, period } = input;
  const choice = await db.from("franchises").select("sliding_scale_key").eq("id", franchiseId).eq("account_id", accountId).maybeSingle();
  const key = choice.error ? null : choice.data?.sliding_scale_key;
  const [grid, summary] = await Promise.all([loadScaleGrid(key), scaleSummary(key)]);
  if (!grid || !summary) return null;
  const scope = await loadScope(db, accountId, franchiseId);
  const data = await loadPeriodData(db, { accountId, from: period.start, to: period.end, franchiseId });
  const rows = routeRows(data.earnings.map((e) => ({ franchiseId: e.franchiseId, date: e.date, driverName: e.sourceDriverName || null, route: e.route, stops: e.stops, mileage: e.mileage ?? null, stopPayPence: e.stopPay ?? null })));
  const result: DiscrepancyReport = buildDiscrepancyReport(rows.get(franchiseId) ?? [], [], { vehicleType: "", vehicleSize: null, fuelType: normaliseFuel("diesel") }, grid);
  const t = result.totals;

  const generatedAt = new Date().toISOString();
  const kit = createReportKit({ title: `Sliding scale discrepancy ${periodLabel(period)} - ${scope.scopeLabel}`, author: scope.accountName });
  kit.title({ account: scope.accountName, heading: "Sliding Scale Discrepancy", scope: scope.scopeLabel, line: `Period ${formatUkDate(period.start)} to ${formatUkDate(period.end)}`, generatedAt });
  kit.heading("Summary", `Each route's stop pay checked against ${summary.name} ${summary.effectiveDate ? `(active from ${formatPortalDate(summary.effectiveDate)})` : ""}, in both directions. Stops and miles are rounded down to the nearest printed row and column, and a route agrees only when its stop pay matches to the penny.`);
  kit.line("Routes checked", String(t.comparedDays));
  kit.line("Agree with the scale", String(t.agreedDays));
  kit.line("Underpaid", `${t.underpaidDays}`, t.underpaidDays > 0 ? `${money(-t.underpaidPence)} short` : "", t.underpaidDays > 0);
  kit.line("Overpaid", `${t.overpaidDays}`, t.overpaidDays > 0 ? `${money(t.overpaidPence)} over` : "");
  kit.line("Net difference", money(t.netPence, { signed: true }), "", true);
  if (t.notComparedDays > 0) kit.line("Not compared", String(t.notComparedDays), "listed below with the reason");

  const differing = result.ordered.filter((o) => o.kind === "underpaid" || o.kind === "overpaid");
  kit.heading("Routes That Differ");
  if (differing.length === 0) kit.paragraph("Every route that could be compared agrees with the scale.", GOOD);
  else {
    kit.table(
      [{ title: "Date", width: 60 }, { title: "Driver and Route", width: 160 }, { title: "Stops", width: 40, align: "right" }, { title: "Paid / Stop", width: 62, align: "right" }, { title: "Scale / Stop", width: 62, align: "right" }, { title: "Difference", width: 66, align: "right" }, { title: "Result", width: 61 }],
      differing.flatMap((o) => o.kind === "agrees" || o.kind === "not_compared" ? [] : [[formatUkDate(o.date), o.label ?? "", String(o.stops), `£${o.paidPerStop.toFixed(2)}`, `£${o.expectedPerStop.toFixed(2)}`, money(o.differencePence, { signed: true }), o.kind === "underpaid" ? "Underpaid" : "Overpaid"]]),
      { fontSize: 8 },
    );
  }
  const skipped = result.ordered.filter((o) => o.kind === "not_compared");
  if (skipped.length > 0) {
    kit.heading("Not Compared", "These routes are not counted as agreeing or differing.");
    kit.table([{ title: "Date", width: 60 }, { title: "Driver and Route", width: 160 }, { title: "Reason", width: 291 }], skipped.flatMap((o) => o.kind === "not_compared" ? [[formatUkDate(o.date), o.label ?? "", NOT_COMPARED_TEXT[o.reason]]] : []), { fontSize: 8 });
  }
  const pdf = await kit.finish(`${scope.scopeLabel} · Sliding Scale Discrepancy`);
  return {
    pdf, csv: discrepancyCsv(result.ordered), scopeLabel: scope.scopeLabel,
    totals: {
      scopeLabel: scope.scopeLabel, scale: summary.name,
      summary: t.underpaidDays + t.overpaidDays === 0 ? `All ${t.comparedDays} routes agree` : `${t.underpaidDays} underpaid (${formatGBP(-t.underpaidPence)}), ${t.overpaidDays} overpaid (${formatGBP(t.overpaidPence)})`,
      compared: t.comparedDays, underpaid: t.underpaidDays, overpaid: t.overpaidDays, underpaidPence: toDb(t.underpaidPence), overpaidPence: toDb(t.overpaidPence),
    },
  };
}
