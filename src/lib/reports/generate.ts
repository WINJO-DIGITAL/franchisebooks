import "server-only";
import { randomUUID } from "node:crypto";
import { formatMonth, monthOf, type YearMonth } from "@/lib/dates";
import { periodLabel, type DpdPeriod } from "@/lib/finance/periods";
import { toDb } from "@/lib/money";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";
import { buildMonthlyReport } from "./monthly";
import { renderMonthlyReportPdf } from "./pdf";
import { buildDiscrepancyPdfReport, buildDriverPayReport, buildProfitLossReport, REPORT_KIND_LABEL, type BuiltReport, type ExtraReportKind } from "./end-of-period";

/** Builds, renders and stores a monthly report, and records it with a snapshot of its headline totals. */
export async function generateMonthlyReport(
  db: AdminClient,
  input: { accountId: string; month: YearMonth; franchiseId: string | null; trigger: "auto" | "manual"; userId?: string | null; period?: DpdPeriod | null },
): Promise<{ id: string; storagePath: string; label: string }> {
  const report = await buildMonthlyReport(db, input);
  const pdf = await renderMonthlyReportPdf(report);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const folder = input.period ? `${input.period.start}_${input.period.end}` : input.month;
  const storagePath = `${input.accountId}/${folder}/${input.franchiseId ?? "all"}-${stamp}-${randomUUID().slice(0, 8)}.pdf`;
  const upload = await db.storage.from("reports").upload(storagePath, pdf, { contentType: "application/pdf", upsert: false });
  if (upload.error) throw new Error(`Could not store the report: ${upload.error.message}`);

  const t = report.totals;
  const totals = {
    scopeLabel: report.scopeLabel,
    revenue: t.revenueStatus === "unavailable" ? null : toDb(t.revenueTotal),
    revenueStatus: t.revenueStatus,
    driverCosts: toDb(t.driverCosts),
    driverOriginalEarnings: toDb(t.driverOriginalEarnings),
    driverAdjustments: toDb(t.driverAdjustmentsNet),
    fuel: toDb(t.fuel),
    otherExpenses: toDb(t.otherExpenses),
    operatingProfit: t.operatingProfit == null ? null : toDb(t.operatingProfit),
    profitStatus: t.profitStatus,
    marginPercent: t.marginPercent,
    earningsMeaning: t.earningsMeaning,
    wagesComplete: t.wagesComplete,
    incomeFromDpd: toDb(t.incomeFromDpd),
  };
  const { data, error } = await db
    .from("monthly_reports")
    .insert({
      account_id: input.accountId, franchise_id: input.franchiseId, report_month: `${input.month}-01`, trigger: input.trigger,
      period_start: input.period?.start ?? null, period_end: input.period?.end ?? null,
      storage_path: storagePath, totals: totals as JsonObject, generated_by: input.userId ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not record the report: ${error.message}`);
  return { id: data.id, storagePath, label: `${report.scopeLabel}, ${input.period ? periodLabel(input.period) : formatMonth(input.month)}` };
}

/**
 * Builds, stores and records one of the end-of-period reports for a DPD period. Returns null when there is nothing to make
 * (a franchise with no sliding scale chosen) or when the database does not have the report kinds yet, so the Period Report
 * is never held up by them.
 */
export async function generateExtraReport(
  db: AdminClient,
  input: { accountId: string; kind: ExtraReportKind; franchiseId: string | null; period: DpdPeriod; trigger: "auto" | "manual"; userId?: string | null },
): Promise<{ id: string; storagePath: string; label: string } | null> {
  const { accountId, kind, franchiseId, period } = input;
  const month = monthOf(period.start);
  let built: BuiltReport | null;
  if (kind === "driver_pay") built = await buildDriverPayReport(db, { accountId, franchiseId, period });
  else if (kind === "profit_loss") built = await buildProfitLossReport(db, { accountId, franchiseId, period, month });
  else {
    if (!franchiseId) throw new Error("The Sliding Scale Discrepancy report is made for one franchise at a time.");
    built = await buildDiscrepancyPdfReport(db, { accountId, franchiseId, period });
  }
  if (!built) return null;

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const base = `${accountId}/${period.start}_${period.end}/${kind}-${franchiseId ?? "all"}-${stamp}-${randomUUID().slice(0, 8)}`;
  const storagePath = `${base}.pdf`;
  const upload = await db.storage.from("reports").upload(storagePath, built.pdf, { contentType: "application/pdf", upsert: false });
  if (upload.error) throw new Error(`Could not store the report: ${upload.error.message}`);
  if (built.csv) {
    const csv = await db.storage.from("reports").upload(`${base}.csv`, Buffer.from(built.csv, "utf8"), { contentType: "text/csv", upsert: false });
    if (csv.error) throw new Error(`Could not store the report's CSV: ${csv.error.message}`);
  }
  const { data, error } = await db
    .from("monthly_reports")
    .insert({
      account_id: accountId, franchise_id: franchiseId, report_month: `${month}-01`, trigger: input.trigger, kind,
      period_start: period.start, period_end: period.end, storage_path: storagePath, totals: built.totals as JsonObject, generated_by: input.userId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    // The database has not had the report kinds migration yet: remove what was stored and carry on without these reports.
    await db.storage.from("reports").remove([storagePath, ...(built.csv ? [`${base}.csv`] : [])]);
    if (/kind/.test(error.message)) return null;
    throw new Error(`Could not record the report: ${error.message}`);
  }
  return { id: data.id, storagePath, label: `${REPORT_KIND_LABEL[kind]}, ${built.scopeLabel}, ${periodLabel(period)}` };
}
