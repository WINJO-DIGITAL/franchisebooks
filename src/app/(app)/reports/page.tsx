import type { Metadata } from "next";
import { GenerateReportForm } from "@/components/reports/generate-form";
import { Badge, EmptyState, PageHeader, Panel, Section, TableWrap } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import { franchiseLabel, getContext } from "@/lib/context";
import { addMonths, formatMonth, formatUkDateTime, monthOf } from "@/lib/dates";
import { lastCompletedPeriod, periodLabel, recentPeriods } from "@/lib/finance/periods";
import { formatGBP, fromDb } from "@/lib/money";

export const metadata: Metadata = { title: "Reports" };

interface Totals {
  scopeLabel?: string;
  revenue?: string | null;
  revenueStatus?: string;
  earningsMeaning?: string;
  wagesComplete?: boolean;
  driverCosts?: string;
  fuel?: string;
  otherExpenses?: string;
  operatingProfit?: string | null;
  profitStatus?: string;
}

export default async function ReportsPage() {
  const ctx = await getContext();
  const current = monthOf(ctx.today);
  const months = Array.from({ length: 24 }, (_, i) => addMonths(current, -i)).map((m) => ({ id: m, label: formatMonth(m) }));
  const periods = recentPeriods(ctx.today, 13).map((p) => ({ id: `period:${p.start}`, label: periodLabel(p) }));
  const monthOptions = months.map((m) => ({ id: `month:${m.id}`, label: m.label }));
  const { data: settings } = await ctx.supabase.from("app_settings").select("report_frequency").eq("account_id", ctx.accountId).maybeSingle();
  const byPeriod = settings?.report_frequency === "dpd_period";
  const defaultReport = byPeriod ? `period:${lastCompletedPeriod(ctx.today).start}` : `month:${addMonths(current, -1)}`;
  const { data: reports } = await ctx.supabase
    .from("monthly_reports")
    .select("id, report_month, period_start, period_end, franchise_id, trigger, totals, generated_at")
    .order("generated_at", { ascending: false })
    .limit(60);
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));

  return (
    <>
      <PageHeader title="Reports" description={byPeriod ? "PDF reports for each DPD four-week period. One is made automatically the evening after each period closes, once the last day's figures have synced, so drivers can see what they earned. Original DPD figures and manual adjustments are always shown separately." : "Monthly PDF reports. Original DPD figures and manual adjustments are always shown separately. Reports for last month are made automatically after month end."} />
      <Section title="Generate a Report">
        <Panel>
          <GenerateReportForm
            periods={periods}
            months={monthOptions}
            franchises={ctx.franchises.map((f) => ({ id: f.id, label: franchiseLabel(f) }))}
            defaultReport={defaultReport}
            defaultFranchiseId={ctx.franchiseId}
          />
          <p className="mt-3 text-sm text-muted">Reports use the figures held at the moment you press the button. Generating again later creates a new copy; earlier copies are kept.</p>
        </Panel>
      </Section>

      <Section title="Previous Reports">
        {(reports ?? []).length === 0 ? (
          <EmptyState title="No Reports Yet">Generate your first report above.</EmptyState>
        ) : (
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr><th>Report</th><th>Scope</th><th className="r">Income</th><th className="r">Wages / Driver Costs</th><th className="r">Fuel &amp; Expenses</th><th className="r">Profit</th><th>Generated</th><th /></tr>
              </thead>
              <tbody>
                {(reports ?? []).map((r) => {
                  const t = (r.totals ?? {}) as Totals;
                  return (
                    <tr key={r.id}>
                      <td className="font-medium">{r.period_start && r.period_end ? periodLabel({ start: r.period_start, end: r.period_end }) : formatMonth(r.report_month.slice(0, 7))}</td>
                      <td>{r.franchise_id ? (franchiseName.get(r.franchise_id) ?? t.scopeLabel ?? "Franchise") : "All franchises"}</td>
                      <td className="r num">{t.earningsMeaning === "route_income" && t.revenue != null ? formatGBP(fromDb(t.revenue)) : "—"}</td>
                      <td className="r num">{t.driverCosts != null ? `${formatGBP(fromDb(t.driverCosts))}${t.earningsMeaning === "route_income" && t.wagesComplete === false ? "+" : ""}` : "—"}</td>
                      <td className="r num">{t.fuel != null ? formatGBP(fromDb(t.fuel) + fromDb(t.otherExpenses ?? 0)) : "—"}</td>
                      <td className="r num">
                        {t.operatingProfit == null ? <span className="text-muted">{t.earningsMeaning === "route_income" ? "Set day rates" : "No revenue"}</span> : <>{formatGBP(fromDb(t.operatingProfit))}{t.profitStatus === "estimated" ? <Badge tone="warn" className="ml-1.5">Est.</Badge> : null}</>}
                      </td>
                      <td className="whitespace-nowrap text-sm text-muted">{formatUkDateTime(r.generated_at)}{r.trigger === "auto" ? <Badge className="ml-2">Automatic</Badge> : null}</td>
                      <td className="r whitespace-nowrap">
                        <a className={buttonClass("quiet", "sm")} href={`/api/reports/${r.id}?view=1`} target="_blank" rel="noreferrer">View</a>
                        <a className={buttonClass("secondary", "sm")} href={`/api/reports/${r.id}`}>Download PDF</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </>
  );
}
