import type { Metadata } from "next";
import Link from "next/link";
import { GenerateReportForm } from "@/components/reports/generate-form";
import { currentPlan } from "@/lib/billing/plan";
import { EmailStatementButton, MakeStatementsForm } from "@/components/reports/statements";
import { Badge, EmptyState, PageHeader, Panel, Section, TableWrap } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import { franchiseLabel, getContext } from "@/lib/context";
import { addMonths, formatMonth, formatUkDateTime, isISODate, monthOf } from "@/lib/dates";
import { lastCompletedPeriod, periodContaining, periodLabel, previousPeriod, recentPeriods, type DpdPeriod } from "@/lib/finance/periods";
import { REPORT_KIND_LABEL } from "@/lib/reports/end-of-period";
import { loadStatementRows, wagesToPay } from "@/lib/statements/rows";
import { formatGBP, fromDb } from "@/lib/money";

export const metadata: Metadata = { title: "Reports" };

/** The DR number (DPD driver reference) for each driver on the account. */
async function loadDrRefs(ctx: Awaited<ReturnType<typeof getContext>>): Promise<Map<string, string | null>> {
  const { data } = await ctx.supabase.from("drivers").select("id, dpd_driver_ref").eq("account_id", ctx.accountId);
  return new Map((data ?? []).map((d) => [d.id, d.dpd_driver_ref]));
}

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
  summary?: string;
  profitStatus?: string;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ statements?: string }> }) {
  const ctx = await getContext();
  // The sliding-scale report is a Max perk: its link is shown to Max accounts only.
  const showScaleReport = (await currentPlan(ctx.supabase)) === "max";
  const params = await searchParams;
  const current = monthOf(ctx.today);
  const months = Array.from({ length: 24 }, (_, i) => addMonths(current, -i)).map((m) => ({ id: m, label: formatMonth(m) }));
  const periods = recentPeriods(ctx.today, 13).map((p) => ({ id: `period:${p.start}`, label: periodLabel(p) }));
  const monthOptions = months.map((m) => ({ id: `month:${m.id}`, label: m.label }));
  const { data: settings } = await ctx.supabase.from("app_settings").select("report_frequency").eq("account_id", ctx.accountId).maybeSingle();
  const byPeriod = settings?.report_frequency === "dpd_period";
  const defaultReport = byPeriod ? `period:${lastCompletedPeriod(ctx.today).start}` : `month:${addMonths(current, -1)}`;
  // "kind" is added by a migration; until it has run, every report is a Period Report.
  const withKind = await ctx.supabase
    .from("monthly_reports")
    .select("id, report_month, period_start, period_end, franchise_id, trigger, totals, generated_at, kind")
    .order("generated_at", { ascending: false })
    .limit(60);
  const reports = withKind.error
    ? ((await ctx.supabase.from("monthly_reports").select("id, report_month, period_start, period_end, franchise_id, trigger, totals, generated_at").order("generated_at", { ascending: false }).limit(60)).data ?? []).map((r) => ({ ...r, kind: "period" }))
    : (withKind.data ?? []);
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const closed = lastCompletedPeriod(ctx.today);
  const statementPeriods = [closed, previousPeriod(closed), previousPeriod(previousPeriod(closed)), previousPeriod(previousPeriod(previousPeriod(closed)))];
  const statementPeriod = isISODate(params.statements) && params.statements <= closed.start ? periodContaining(params.statements) : closed;
  const statements = ctx.canWrite ? await loadStatementRows(ctx, statementPeriod) : null;
  const wages = statements ? wagesToPay(statements.rows, await loadDrRefs(ctx)) : null;

  return (
    <>
      <PageHeader title="Reports" description={byPeriod ? "PDF reports for each DPD four-week period. One is made automatically the evening after each period closes, once the last day's figures have synced, so drivers can see what they earned. Original DPD figures and manual adjustments are always shown separately." : "Monthly PDF reports. Original DPD figures and manual adjustments are always shown separately. Reports for last month are made automatically after month end."} />
      {showScaleReport ? (
        <Section title="Sliding Scale Report" description="Max plan: each day's stop pay checked against the sliding scale you have entered, in both directions.">
          <Panel>
            <Link href="/reports/scale" className={buttonClass("secondary", "md")}>Open the Sliding Scale Report</Link>
          </Panel>
        </Section>
      ) : null}
      <Section title="Generate a Report">
        <Panel>
          <GenerateReportForm
            periods={periods}
            months={monthOptions}
            franchises={ctx.franchises.map((f) => ({ id: f.id, label: franchiseLabel(f) }))}
            defaultReport={defaultReport}
            defaultFranchiseId={ctx.franchiseId}
            allowAll={ctx.allFranchises}
            showDiscrepancy={showScaleReport}
          />
          <p className="mt-3 text-sm text-muted">The Driver Pay Report, Profit and Loss{showScaleReport ? " and Sliding Scale Discrepancy" : ""} are for a DPD four-week period, and are also made automatically the evening after each period closes. Reports use the figures held at the moment you press the button. Generating again later creates a new copy; earlier copies are kept.</p>
        </Panel>
      </Section>

      {wages && wages.lines.length > 0 ? (
        <Section title="Wages to Pay" description="What you pay each driver for this pay period, with every franchise added together so each person is paid once. Per-franchise statements are below.">
          <TableWrap>
            <table className="ledger" data-testid="wages-to-pay">
              <thead><tr><th>Driver</th><th>DR Number</th><th className="r hidden sm:table-cell">Franchises</th><th className="r">Amount to Pay</th></tr></thead>
              <tbody>
                {wages.lines.map((l) => (
                  <tr key={l.driverId}>
                    <td className="font-medium">{l.name}</td>
                    <td className="num">{l.dr ?? "—"}</td>
                    <td className="r num hidden sm:table-cell">{l.franchises}</td>
                    <td className="r num font-semibold">{l.total == null ? <span className="font-normal text-muted">Incomplete</span> : formatGBP(l.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-strong font-semibold">
                  <td>Total, {wages.lines.length} {wages.lines.length === 1 ? "driver" : "drivers"}</td><td />
                  <td className="hidden sm:table-cell" />
                  <td className="r num">{wages.complete ? formatGBP(wages.total) : <span className="font-normal text-muted">Incomplete</span>}</td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a className={buttonClass("secondary", "sm")} href={`/api/export/wages?period=${statementPeriod.start}`}>Download Spreadsheet</a>
            {!wages.complete ? <span className="text-sm text-muted">Some drivers have an incomplete statement, so the total is not final until those are fixed.</span> : null}
          </div>
        </Section>
      ) : null}

      {statements ? (
        <Section title="Driver Statements" description="A one-page statement for each driver, for each DPD pay period, made automatically when the period closes. Drivers can download their own from their page.">
          <nav aria-label="Statement pay period" className="mb-4 flex flex-wrap gap-2">
            {statementPeriods.map((p) => (
              <Link key={p.start} href={`/reports?statements=${p.start}`} className={buttonClass(p.start === statementPeriod.start ? "primary" : "secondary", "sm")}>{periodLabel(p)}</Link>
            ))}
          </nav>
          {statements.rows.length === 0 ? (
            <EmptyState title="No Drivers in This Period">Statements appear here for each driver who worked in the period.</EmptyState>
          ) : (
            <TableWrap>
              <table className="ledger" data-testid="driver-statements">
                <thead>
                  <tr><th>Driver</th>{statements.manyFranchises ? <th className="hidden sm:table-cell">Franchise</th> : null}<th className="hidden sm:table-cell">Number</th><th className="r">Total</th><th>Statement</th></tr>
                </thead>
                <tbody>
                  {statements.rows.map((r) => (
                    <tr key={`${r.franchiseId}-${r.driverId}`}>
                      <td className="font-medium">{r.name}{r.title === "Self-billed invoice" ? <Badge className="ml-2">Self-billed</Badge> : null}</td>
                      {statements.manyFranchises ? <td className="hidden sm:table-cell">{franchiseName.get(r.franchiseId) ?? ""}</td> : null}
                      <td className="num hidden sm:table-cell">{r.number ?? "—"}</td>
                      <td className="r num">{r.total == null ? "—" : formatGBP(r.total)}</td>
                      <td>
                        {r.id ? (
                          <span className="flex flex-wrap items-center gap-1">
                            <a className={buttonClass("secondary", "sm")} href={`/api/statements/${r.id}`}>Download PDF</a>
                            {ctx.isOwner ? <EmailStatementButton id={r.id} emailedAt={r.emailedAt} /> : null}
                            {r.emailedAt ? <span className="text-xs text-muted">Emailed {formatUkDateTime(r.emailedAt)}</span> : null}
                          </span>
                        ) : r.reason ? (
                          <span className="text-sm"><Badge tone="warn" className="mr-2">Not made</Badge>{r.reason} <Link className="underline" href={`/drivers/${r.driverId}`}>Open driver</Link></span>
                        ) : (
                          <span className="text-sm text-muted">Not made yet</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <div className="mt-4 flex flex-wrap items-start gap-3">
            {statements.rows.some((r) => r.id) ? (
              <a className={buttonClass("primary")} href={`/api/statements/zip?period=${statementPeriod.start}${ctx.franchiseId ? `&franchise=${ctx.franchiseId}` : ""}`}>Download All (Zip)</a>
            ) : null}
            {statements.rows.length > 0 ? <MakeStatementsForm periodStart={statementPeriod.start} franchiseId={ctx.franchiseId} label={statements.rows.some((r) => r.id) ? "Make Statements Again" : "Make Statements Now"} /> : null}
          </div>
          <p className="mt-3 text-sm text-muted">Titled &ldquo;Driver statement&rdquo; with no VAT, unless the driver has a VAT number or a signed self-billing agreement (set on the driver&rsquo;s page). Nothing is emailed to drivers unless you press &ldquo;Email to driver&rdquo;.</p>
        </Section>
      ) : null}

      <Section title="Previous Reports">
        {reports.length === 0 ? (
          <EmptyState title="No Reports Yet">Generate your first report above.</EmptyState>
        ) : (
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr><th>Report</th><th>Scope</th><th className="r">Income</th><th className="r">Wages / Driver Costs</th><th className="r">Fuel &amp; Expenses</th><th className="r">Profit</th><th>Generated</th><th /></tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const t = (r.totals ?? {}) as Totals;
                  const kind = (r.kind ?? "period") as keyof typeof REPORT_KIND_LABEL;
                  const extra = kind !== "period";
                  return (
                    <tr key={r.id}>
                      <td className="font-medium">{r.period_start && r.period_end ? periodLabel({ start: r.period_start, end: r.period_end }) : formatMonth(r.report_month.slice(0, 7))}{extra ? <Badge className="ml-2">{REPORT_KIND_LABEL[kind]}</Badge> : null}</td>
                      <td>{r.franchise_id ? (franchiseName.get(r.franchise_id) ?? t.scopeLabel ?? "Franchise") : "All franchises"}</td>
                      {extra && kind !== "profit_loss" ? <td className="text-sm" colSpan={4}>{t.summary ?? ""}</td> : <>
                      <td className="r num">{t.earningsMeaning === "route_income" && t.revenue != null ? formatGBP(fromDb(t.revenue)) : "—"}</td>
                      <td className="r num">{t.driverCosts != null ? `${formatGBP(fromDb(t.driverCosts))}${t.earningsMeaning === "route_income" && t.wagesComplete === false ? "+" : ""}` : "—"}</td>
                      <td className="r num">{t.fuel != null ? formatGBP(fromDb(t.fuel) + fromDb(t.otherExpenses ?? 0)) : "—"}</td>
                      <td className="r num">
                        {t.operatingProfit == null ? <span className="text-muted">{t.earningsMeaning === "route_income" ? "Set day rates" : "No revenue"}</span> : <>{formatGBP(fromDb(t.operatingProfit))}{t.profitStatus === "estimated" ? <Badge tone="warn" className="ml-1.5">Est.</Badge> : null}</>}
                      </td></>}
                      <td className="whitespace-nowrap text-sm text-muted">{formatUkDateTime(r.generated_at)}{r.trigger === "auto" ? <Badge className="ml-2">Automatic</Badge> : null}</td>
                      <td className="r whitespace-nowrap">
                        <a className={buttonClass("quiet", "sm")} href={`/api/reports/${r.id}?view=1`} target="_blank" rel="noreferrer">View</a>
                        <a className={buttonClass("secondary", "sm")} href={`/api/reports/${r.id}`}>Download PDF</a>
                        {kind === "discrepancy" ? <a className={buttonClass("secondary", "sm")} href={`/api/reports/${r.id}?format=csv`}>Download CSV</a> : null}
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


