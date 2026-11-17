import type { Metadata } from "next";
import { GenerateReportForm } from "@/components/reports/generate-form";
import { Badge, EmptyState, PageHeader, Panel, Section, TableWrap } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import { franchiseLabel, getContext } from "@/lib/context";
import { addMonths, formatMonth, formatUkDateTime, monthOf } from "@/lib/dates";
import { formatGBP, fromDb } from "@/lib/money";

export const metadata: Metadata = { title: "Reports" };

interface Totals {
  scopeLabel?: string;
  revenue?: string | null;
  revenueStatus?: string;
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
  const { data: reports } = await ctx.supabase
    .from("monthly_reports")
    .select("id, report_month, franchise_id, trigger, totals, generated_at")
    .order("report_month", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(60);
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));

  return (
    <>
      <PageHeader title="Reports" description="Monthly PDF reports. Original DPD figures and manual adjustments are always shown separately. Reports for last month are made automatically after month end." />
      <Section title="Generate a report">
        <Panel>
          <GenerateReportForm
            months={months}
            franchises={ctx.franchises.map((f) => ({ id: f.id, label: franchiseLabel(f) }))}
            defaultMonth={addMonths(current, -1)}
            defaultFranchiseId={ctx.franchiseId}
          />
          <p className="mt-3 text-sm text-muted">Reports use the figures held at the moment you press the button. Generating again later creates a new copy; earlier copies are kept.</p>
        </Panel>
      </Section>

      <Section title="Previous reports">
        {(reports ?? []).length === 0 ? (
          <EmptyState title="No reports yet">Generate your first report above.</EmptyState>
        ) : (
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr><th>Month</th><th>Scope</th><th className="r">Driver costs</th><th className="r">Fuel &amp; expenses</th><th className="r">Profit</th><th>Generated</th><th /></tr>
              </thead>
              <tbody>
                {(reports ?? []).map((r) => {
                  const t = (r.totals ?? {}) as Totals;
                  return (
                    <tr key={r.id}>
                      <td className="font-medium">{formatMonth(r.report_month.slice(0, 7))}</td>
                      <td>{r.franchise_id ? (franchiseName.get(r.franchise_id) ?? t.scopeLabel ?? "Franchise") : "All franchises"}</td>
                      <td className="r num">{t.driverCosts != null ? formatGBP(fromDb(t.driverCosts)) : "—"}</td>
                      <td className="r num">{t.fuel != null ? formatGBP(fromDb(t.fuel) + fromDb(t.otherExpenses ?? 0)) : "—"}</td>
                      <td className="r num">
                        {t.operatingProfit == null ? <span className="text-muted">No revenue</span> : <>{formatGBP(fromDb(t.operatingProfit))}{t.profitStatus === "estimated" ? <Badge tone="warn" className="ml-1.5">Est.</Badge> : null}</>}
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
