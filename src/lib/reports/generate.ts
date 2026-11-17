import "server-only";
import { formatMonth, type YearMonth } from "@/lib/dates";
import { toDb } from "@/lib/money";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";
import { buildMonthlyReport } from "./monthly";
import { renderMonthlyReportPdf } from "./pdf";

/** Builds, renders and stores a monthly report, and records it with a snapshot of its headline totals. */
export async function generateMonthlyReport(
  db: AdminClient,
  input: { accountId: string; month: YearMonth; franchiseId: string | null; trigger: "auto" | "manual"; userId?: string | null },
): Promise<{ id: string; storagePath: string; label: string }> {
  const report = await buildMonthlyReport(db, input);
  const pdf = await renderMonthlyReportPdf(report);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const storagePath = `${input.accountId}/${input.month}/${input.franchiseId ?? "all"}-${stamp}.pdf`;
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
  };
  const { data, error } = await db
    .from("monthly_reports")
    .insert({
      account_id: input.accountId, franchise_id: input.franchiseId, report_month: `${input.month}-01`, trigger: input.trigger,
      storage_path: storagePath, totals: totals as JsonObject, generated_by: input.userId ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not record the report: ${error.message}`);
  return { id: data.id, storagePath, label: `${report.scopeLabel}, ${formatMonth(input.month)}` };
}
