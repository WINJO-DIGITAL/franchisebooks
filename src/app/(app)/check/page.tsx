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
import { checkStopRates, normaliseFuel, type ScaleBand } from "@/lib/finance/sliding-scale";
import { lastCompletedPeriod, periodContaining, periodLabel, recentPeriods } from "@/lib/finance/periods";
import { formatGBP, fromDb } from "@/lib/money";

export const metadata: Metadata = { title: "Period Check" };

const STATUS: Record<IncomeStatus, { label: string; tone: Tone }> = {
  match: { label: "Matches the Invoice", tone: "good" },
  differs: { label: "Does Not Match", tone: "bad" },
  waiting: { label: "Invoice Not in Yet", tone: "warn" },
  unreadable: { label: "Invoice Could Not Be Read", tone: "warn" },
  unread: { label: "Days Not Read Yet", tone: "warn" },
};

export default async function PeriodCheckPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  // The period to check: the one picked, or the most recent that has closed.
  const period = isISODate(params.period) ? periodContaining(params.period) : lastCompletedPeriod(ctx.today);
  const choices = recentPeriods(ctx.today, 7);

  const franchises = ctx.franchise ? [ctx.franchise] : ctx.franchises.filter((f) => f.isActive);
  const [earnings, costs, invoiceRows, settings, vehicleRows, scaleRows] = await Promise.all([
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
    fetchAll(() => ctx.supabase.from("franchises").select("id, vehicle_type, vehicle_size, vehicle_fuel").eq("account_id", ctx.accountId).order("id")),
    fetchAll(() => ctx.supabase.from("sliding_scale_rates").select("vehicle_type, vehicle_size, fuel_type, stops_from, stops_to, miles_from, miles_to, rate").eq("account_id", ctx.accountId).order("id")),
  ]);
  // The first and last day of daily payments held for each franchise: an invoice is only compared with days the app has read.
  const coverage = new Map<string, { first: string | null; last: string | null }>();
  await Promise.all(franchises.map(async (f) => {
    const edge = async (ascending: boolean) => {
      const { data } = await ctx.supabase.from("daily_earnings").select("report_date").eq("account_id", ctx.accountId).eq("franchise_id", f.id).eq("is_current", true).order("report_date", { ascending }).limit(1);
      return data?.[0]?.report_date ?? null;
    };
    coverage.set(f.id, { first: await edge(true), last: await edge(false) });
  }));
  const bands: ScaleBand[] = scaleRows.map((r) => ({
    vehicleType: r.vehicle_type, vehicleSize: r.vehicle_size, fuelType: normaliseFuel(r.fuel_type), stopsFrom: r.stops_from, stopsTo: r.stops_to,
    milesFrom: r.miles_from, milesTo: r.miles_to, rate: Number(r.rate),
  }));
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
      charges: costs.filter((c) => c.franchiseId === f.id && c.source === "dpd_portal").map((c) => ({ net: c.amount, vat: c.vat })),
      invoice,
      tolerancePence,
      coverage: coverage.get(f.id),
    });
    const chargeItems = costs.filter((c) => c.franchiseId === f.id && c.source === "dpd_portal");
    const vehicle = vehicleRows.find((v) => v.id === f.id);
    const rateCheck = vehicle?.vehicle_type && bands.length > 0
      ? checkStopRates(
          earnings.filter((e) => e.franchiseId === f.id).map((e) => ({ date: e.date, stops: e.stops, miles: e.mileage ?? null, stopPayPence: e.stopPay ?? null })),
          bands,
          { vehicleType: vehicle.vehicle_type, vehicleSize: vehicle.vehicle_size, fuelType: normaliseFuel(vehicle.vehicle_fuel ?? "diesel") },
        )
      : null;
    return { franchise: f, invoice, check, chargeItems, rateCheck, hasVehicle: Boolean(vehicle?.vehicle_type), firstDay: coverage.get(f.id)?.first ?? null };
  });

  return (
    <>
      <PageHeader
        title="Period Check"
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
        <EmptyState title="No Franchises Yet">Add a franchise in Settings, then the DPD sync fills this in.</EmptyState>
      ) : (
        results.map(({ franchise, invoice, check, chargeItems, rateCheck, hasVehicle, firstDay }) => (
          <Section key={franchise.id} title={franchiseLabel(franchise)}>
            <Panel>
              <div className="grid gap-6 sm:grid-cols-3">
                <Stat
                  label="Money in (daily payments)"
                  value={check.income.status === "unread" ? "Not Read Yet" : formatGBP(check.income.ourPayments)}
                  sub={check.income.invoiceStopPay == null ? "Invoice stop pay: not available yet" : `Invoice stop pay: ${formatGBP(check.income.invoiceStopPay)}`}
                  status={<Badge tone={STATUS[check.income.status].tone}>{STATUS[check.income.status].label}</Badge>}
                />
                <Stat
                  label="Money Out (DPD Charges)"
                  value={formatGBP(check.charges.net)}
                  sub="Before VAT. The total with VAT is shown below."
                />
                <Stat
                  label="Invoice Total"
                  value={check.invoiceStated == null ? "Waiting for the Invoice" : formatGBP(check.invoiceStated.invoiceTotal)}
                  sub={check.invoiceStated == null ? undefined : `${formatGBP(check.invoiceStated.netTotal)} before VAT + ${formatGBP(check.invoiceStated.vatTotal)} VAT${check.invoiceStated.dueDate ? `, due ${formatUkDate(check.invoiceStated.dueDate)}` : ""}.`}
                />
              </div>
              <div className="mt-6 grid gap-6 border-t border-line pt-6 sm:grid-cols-3">
                <Stat label="Total Before VAT" value={formatGBP(check.charges.net)} sub={`${check.charges.count} charge${check.charges.count === 1 ? "" : "s"}`} />
                <Stat
                  label="VAT"
                  value={formatGBP(check.charges.vatStated)}
                  sub={check.charges.vatStatedOn === 0 ? "No VAT on these charges" : check.charges.vatStatedOn < check.charges.count ? `On ${check.charges.vatStatedOn} of ${check.charges.count} charges` : `On all ${check.charges.count} charges`}
                />
                <Stat label="Total With VAT" value={formatGBP(check.charges.gross)} sub="Before VAT plus VAT" />
              </div>

              {check.income.status === "unread" ? (
                <p className="mt-4 text-sm text-ink-soft">
                  {firstDay
                    ? `The app holds daily payments from ${formatUkDate(firstDay)}. This period starts before that, so there is nothing to compare the invoice with. The invoice itself is not in question.`
                    : "The app has not read any daily payments for this franchise yet, so there is nothing to compare the invoice with. The invoice itself is not in question."}
                </p>
              ) : null}

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
                        <tr><td className="font-medium">Total Before VAT (VAT {formatGBP(invoice.vatTotal)}, {formatGBP(invoice.invoiceTotal)} with VAT)</td><td className="r num font-medium">{formatGBP(invoice.netTotal)}</td></tr>
                      </>
                    ) : (
                      <tr><td colSpan={2} className="text-muted">{invoice ? "The invoice was downloaded but its lines could not be read reliably." : "The invoice has not been collected yet. It appears after DPD posts it and the next sync runs."}</td></tr>
                    )}
                  </tbody>
                </table>
              </TableWrap>

              <TableWrap>
                <table className="ledger">
                  <thead><tr><th>DPD Charges (From the Charges Page)</th><th className="r">Net</th></tr></thead>
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

            <div className="mt-4">
              <Panel>
                <h3 className="text-sm font-semibold">Stop Rate Against the Sliding Scale</h3>
                {rateCheck == null ? (
                  <p className="mt-1 text-sm text-muted">
                    {hasVehicle ? "Enter the sliding scale to check each day's rate." : "Set this franchise's vehicle in Settings, and enter the sliding scale, to check each day's rate against it."}
                  </p>
                ) : rateCheck.differs.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-soft">
                    <Badge tone="good">All agree</Badge> {rateCheck.agreed} day{rateCheck.agreed === 1 ? "" : "s"} matched the scale
                    {rateCheck.notChecked > 0 ? `; ${rateCheck.notChecked} could not be compared (missing stops, miles, or no single matching band).` : "."}
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-ink-soft">{rateCheck.differs.length} day{rateCheck.differs.length === 1 ? "" : "s"} paid a different rate from the scale; {rateCheck.agreed} matched{rateCheck.notChecked > 0 ? `; ${rateCheck.notChecked} could not be compared` : ""}.</p>
                    <TableWrap>
                      <table className="ledger mt-2">
                        <thead><tr><th>Date</th><th className="r">Stops</th><th className="r">Scale Says</th><th className="r">DPD Paid</th></tr></thead>
                        <tbody>
                          {rateCheck.differs.slice(0, 20).map((d) => (
                            <tr key={d.date + d.stops}><td>{formatUkDate(d.date)}</td><td className="r num">{d.stops}</td><td className="r num">£{d.expected.toFixed(2)}</td><td className="r num text-bad">£{d.actual.toFixed(2)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </TableWrap>
                  </>
                )}
              </Panel>
            </div>
          </Section>
        ))
      )}
    </>
  );
}
