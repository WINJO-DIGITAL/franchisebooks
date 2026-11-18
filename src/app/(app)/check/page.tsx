import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import type { Tone } from "@/components/ui/bits";
import { resolveAnomalyConfig } from "@/lib/anomalies/detect";
import { franchiseLabel, getContext } from "@/lib/context";
import { fetchAll } from "@/lib/data/fetch-all";
import { loadCosts, loadEarnings } from "@/lib/data/period";
import { formatUkDate, isISODate } from "@/lib/dates";
import { checkPeriod, type CheckInvoice, type IncomeStatus } from "@/lib/finance/period-check";
import { lastCompletedPeriod, periodContaining, periodLabel, recentPeriods } from "@/lib/finance/periods";
import { formatGBP, fromDb } from "@/lib/money";

export const metadata: Metadata = { title: "Period check" };

const STATUS: Record<IncomeStatus, { label: string; tone: Tone }> = {
  match: { label: "Matches the invoice", tone: "good" },
  differs: { label: "Does not match", tone: "bad" },
  waiting: { label: "Invoice not in yet", tone: "warn" },
  unreadable: { label: "Invoice could not be read", tone: "warn" },
};

export default async function PeriodCheckPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  // The period to check: the one picked, or the most recent that has closed.
  const period = isISODate(params.period) ? periodContaining(params.period) : lastCompletedPeriod(ctx.today);
  const choices = recentPeriods(ctx.today, 7);

  const franchises = ctx.franchise ? [ctx.franchise] : ctx.franchises.filter((f) => f.isActive);
  const [earnings, costs, invoiceRows, settings] = await Promise.all([
    loadEarnings(ctx.supabase, { accountId: ctx.accountId, from: period.start, to: period.end, franchiseId: ctx.franchiseId }),
    loadCosts(ctx.supabase, { accountId: ctx.accountId, from: period.start, to: period.end, franchiseId: ctx.franchiseId }),
    fetchAll(() => {
      let q = ctx.supabase
        .from("dpd_invoices")
        .select("franchise_id, invoice_no, due_date, net_total, vat_total, invoice_total, reconciled, lines")
        .eq("account_id", ctx.accountId)
        .eq("period_start", period.start)
        .order("id");
      if (ctx.franchiseId) q = q.eq("franchise_id", ctx.franchiseId);
      return q;
    }),
    ctx.supabase.from("app_settings").select("anomaly_config").eq("account_id", ctx.accountId).maybeSingle(),
  ]);
  const tolerancePence = resolveAnomalyConfig(settings.data?.anomaly_config).invoiceTolerancePence;

  const results = franchises.map((f) => {
    const row = invoiceRows.find((r) => r.franchise_id === f.id);
    const lines = row && Array.isArray(row.lines) ? (row.lines as { description?: string; amount?: number }[]) : [];
    const invoice: CheckInvoice | null = row
      ? {
          invoiceNo: row.invoice_no,
          dueDate: row.due_date,
          netTotal: fromDb(row.net_total),
          vatTotal: fromDb(row.vat_total),
          invoiceTotal: fromDb(row.invoice_total),
          reconciled: row.reconciled,
          lines: lines.filter((l) => l.description && typeof l.amount === "number").map((l) => ({ description: l.description!, amount: l.amount! })),
        }
      : null;
    const check = checkPeriod({
      period,
      payments: earnings.filter((e) => e.franchiseId === f.id).map((e) => e.gross),
      charges: costs.filter((c) => c.franchiseId === f.id && c.source === "dpd_portal").map((c) => c.amount),
      invoice,
      tolerancePence,
    });
    const chargeItems = costs.filter((c) => c.franchiseId === f.id && c.source === "dpd_portal");
    return { franchise: f, invoice, check, chargeItems };
  });

  return (
    <>
      <PageHeader
        title="Period check"
        description={`Our figures against DPD's invoices for ${periodLabel(period)}. Check it once the invoice and charges are in, before paying drivers.`}
      />

      <nav aria-label="Pay period" className="-mt-2 mb-6 flex flex-wrap gap-2">
        {choices.map((p) => (
          <Link key={p.start} href={`/check?period=${p.start}`} className={buttonClass(p.start === period.start ? "primary" : "secondary", "sm")}>
            {periodLabel(p)}
          </Link>
        ))}
      </nav>

      {results.length === 0 ? (
        <EmptyState title="No franchises yet">Add a franchise in Settings, then the DPD sync fills this in.</EmptyState>
      ) : (
        results.map(({ franchise, invoice, check, chargeItems }) => (
          <Section key={franchise.id} title={franchiseLabel(franchise)}>
            <Panel>
              <div className="grid gap-6 sm:grid-cols-3">
                <Stat
                  label="Money in (daily payments)"
                  value={formatGBP(check.income.ourPayments)}
                  sub={check.income.invoiceStopPay == null ? "Invoice stop pay: not available yet" : `Invoice stop pay: ${formatGBP(check.income.invoiceStopPay)}`}
                  status={<Badge tone={STATUS[check.income.status].tone}>{STATUS[check.income.status].label}</Badge>}
                />
                <Stat
                  label="Money out (DPD charges)"
                  value={formatGBP(check.charges.net)}
                  sub={`${formatGBP(check.charges.vatEstimate)} VAT (estimated at 20%) = ${formatGBP(check.charges.grossEstimate)}`}
                />
                <Stat
                  label={`Due ${formatUkDate(check.payable.dueDate)}`}
                  value={check.payable.expected == null ? "Waiting for the invoice" : formatGBP(check.payable.expected)}
                  sub={check.payable.expected == null ? undefined : "Self-billed total less charges. Compare with the remittance advice (it can differ by a penny)."}
                />
              </div>

              {check.income.status === "differs" && check.income.difference != null ? (
                <p className="mt-4 text-sm text-bad">
                  Our daily payments are {formatGBP(Math.abs(check.income.difference))} {check.income.difference > 0 ? "more" : "less"} than the invoice. A day may be missing or posted late: run Sync DPD, then compare with the Payments page in the DPD portal.
                </p>
              ) : null}
            </Panel>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <TableWrap>
                <table className="ledger">
                  <thead><tr><th>{invoice ? `Self-billed invoice ${invoice.invoiceNo}` : "Self-billed invoice"}</th><th className="r">Net</th></tr></thead>
                  <tbody>
                    {invoice && invoice.reconciled ? (
                      <>
                        {invoice.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="r num">{formatGBP(l.amount)}</td></tr>)}
                        <tr><td className="font-medium">Total (VAT {formatGBP(invoice.vatTotal)}; with VAT {formatGBP(invoice.invoiceTotal)})</td><td className="r num font-medium">{formatGBP(invoice.netTotal)}</td></tr>
                      </>
                    ) : (
                      <tr><td colSpan={2} className="text-muted">{invoice ? "The invoice was downloaded but its lines could not be read reliably." : "The invoice has not been collected yet. It appears after DPD posts it and the next sync runs."}</td></tr>
                    )}
                  </tbody>
                </table>
              </TableWrap>

              <TableWrap>
                <table className="ledger">
                  <thead><tr><th>DPD charges (from the Charges page)</th><th className="r">Net</th></tr></thead>
                  <tbody>
                    {chargeItems.length === 0 ? (
                      <tr><td colSpan={2} className="text-muted">No charges were collected for this period.</td></tr>
                    ) : (
                      <>
                        {chargeItems.map((c) => <tr key={c.id}><td>{c.description ?? c.categoryName}</td><td className="r num">{formatGBP(c.amount)}</td></tr>)}
                        <tr><td className="font-medium">Total (compare with the DPD invoice)</td><td className="r num font-medium">{formatGBP(check.charges.net)}</td></tr>
                      </>
                    )}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          </Section>
        ))
      )}
    </>
  );
}
