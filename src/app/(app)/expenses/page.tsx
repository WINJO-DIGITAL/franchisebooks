import type { Metadata } from "next";
import Link from "next/link";
import { PeriodNav } from "@/components/ui/period-nav";
import { AddExpenseButton, AssignCostButton } from "@/components/expenses/forms";
import { Badge, EmptyState, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { cn } from "@/components/ui/cn";
import { buttonClass } from "@/components/ui/button";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { voidCost } from "@/lib/actions/expenses";
import { franchiseLabel, getContext } from "@/lib/context";
import { fetchAll } from "@/lib/data/fetch-all";
import { loadCosts, loadDriverNames, loadPeriodData } from "@/lib/data/period";
import { driverIdentity, summarisePeriod } from "@/lib/finance/calc";
import { addDays, formatUkDate } from "@/lib/dates";
import { periodFromParam, periodLabel } from "@/lib/finance/periods";
import { summariseCosts } from "@/lib/finance/cost-summary";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatGBP, sumPence } from "@/lib/money";

export const metadata: Metadata = { title: "Expenses" };

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "fuel", label: "Fuel" },
  { key: "other", label: "Other Expenses" },
  { key: "unallocated", label: "Unallocated" },
] as const;

function Row({ label, value, tone, strong = false, large = false, note }: { label: string; value: string; tone?: "bad"; strong?: boolean; large?: boolean; note?: string }) {
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-4">
        <dt className={strong ? "font-semibold" : "text-ink-soft"}>{label}</dt>
        <dd className={`num ${large ? "text-2xl" : "text-base"} ${strong ? "font-semibold" : "font-medium"} ${tone === "bad" ? "text-bad" : ""}`}>{value}</dd>
      </div>
      {note ? <p className="mt-0.5 text-right text-xs text-muted">{note}</p> : null}
    </div>
  );
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ period?: string; show?: string; add?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const period = periodFromParam(params.period, ctx.today);
  const show = FILTERS.some((f) => f.key === params.show) ? (params.show as (typeof FILTERS)[number]["key"]) : "all";
  const { start, end } = period;

  const [costs, names, categories, periodData] = await Promise.all([
    loadCosts(ctx.supabase, { accountId: ctx.accountId, from: start, to: end, franchiseId: ctx.franchiseId, hiddenFranchiseIds: ctx.hiddenFranchiseIds }),
    loadDriverNames(ctx.supabase, ctx.accountId),
    fetchAll(() => ctx.supabase.from("expense_categories").select("id, name, kind, is_active").eq("is_active", true).order("sort_order").order("id")),
    loadPeriodData(ctx.supabase, { accountId: ctx.accountId, from: start, to: end, franchiseId: ctx.franchiseId, hiddenFranchiseIds: ctx.hiddenFranchiseIds }),
  ]);
  // Driver wages are a cost of the business, so they sit here with fuel and other expenses. Income is never reduced by them.
  const periodTotals = summarisePeriod(periodData).combined;
  const wages = periodTotals.wages;
  const wagesLabel = periodTotals.earningsMeaning === "route_income" ? "Driver wages" : "Driver pay";
  const peoplePaid = new Set(periodData.earnings.map((e) => driverIdentity(e.driverId, e.sourceDriverName))).size;
  const { data: activeDrivers } = await ctx.supabase.from("drivers").select("id, display_name").eq("is_active", true).order("display_name");
  const drivers = (activeDrivers ?? []).map((d) => ({ id: d.id, label: d.display_name }));
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const isFuel = (c: (typeof costs)[number]) => c.kind === "fuel" || c.categoryKind === "fuel";
  const fuelTotal = sumPence(costs.filter(isFuel).map((c) => c.amount));
  const otherTotal = sumPence(costs.filter((c) => !isFuel(c)).map((c) => c.amount));
  const unallocated = costs.filter((c) => c.allocation.scope === "unallocated");
  const litres = costs.reduce((n, c) => n + (c.litres ?? 0), 0);
  const summary = summariseCosts(costs);
  const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

  const visible = costs
    .filter((c) => (show === "fuel" ? isFuel(c) : show === "other" ? !isFuel(c) : show === "unallocated" ? c.allocation.scope === "unallocated" : true))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const query = (next: Record<string, string>) => `/expenses?${new URLSearchParams({ period: period.start, show, ...next }).toString()}`;

  return (
    <>
      <PageHeader
        title="Expenses"
        description={`${periodLabel(period)} · ${ctx.franchise ? franchiseLabel(ctx.franchise) : "All franchises"}`}
        actions={ctx.canWrite ? (
          <AddExpenseButton
            franchises={ctx.franchises.filter((f) => f.isActive).map((f) => ({ id: f.id, label: franchiseLabel(f) }))}
            categories={categories.map((c) => ({ id: c.id, label: c.name }))} drivers={drivers} today={ctx.today} defaultFranchiseId={ctx.franchiseId} startOpen={params.add === "1"}
          />
        ) : null}
      />
      <PeriodNav period={period} today={ctx.today} hrefFor={(p) => query({ period: p })} exportHref={`/api/export/costs?period=${period.start}`} />

      {summary.byCategory.length > 0 || wages > 0 ? (
        <Section title="Costs">
          {(() => {
            const rows = [
              ...(wages > 0 ? [{ key: "wages", name: wagesLabel, count: peoplePaid, amount: wages, note: `${peoplePaid} ${peoplePaid === 1 ? "person" : "people"}` }] : []),
              ...summary.byCategory.map((c) => ({ key: c.name, name: c.name, count: c.count, amount: c.amount, note: undefined as string | undefined })),
            ];
            const base = wages + summary.beforeVat;
            const share = (amount: number) => (base > 0 ? Math.max(2, (amount / base) * 100) : 0);
            const Line = ({ r }: { r: (typeof rows)[number] }) => (
              <tr>
                <td className="font-medium">
                  {r.name}
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                    <span className="block h-1.5 rounded-full bg-bad/70" style={{ width: `${share(r.amount)}%` }} />
                  </span>
                  {r.note ? <span className="block text-xs font-normal text-muted">{r.note}</span> : null}
                </td>
                <td className="r num align-top">{r.count}</td>
                <td className="r num align-top">{formatGBP(r.amount)}</td>
              </tr>
            );
            const top = rows.slice(0, 5);
            const rest = rows.slice(5);
            return (
              <>
                <Panel className="mb-5">
                  <dl className="divide-y divide-line">
                    <Row label="Total before VAT" value={formatGBP(base)} tone="bad" strong note={summary.vatNotStatedCount + summary.vatInclusiveCount > 0 ? "Only costs that state their VAT" : undefined} />
                    <Row label="VAT" value={formatGBP(summary.vat)} tone="bad" />
                    {summary.vatNotStatedCount > 0 ? (
                      <Row label="VAT not stated" value={formatGBP(summary.vatNotStated)} note={`${items(summary.vatNotStatedCount)}: the document does not say whether VAT is included`} />
                    ) : null}
                    <Row label="Total with VAT" value={formatGBP(wages + summary.withVat)} tone="bad" strong large note={summary.vatInclusiveCount > 0 ? `Includes ${formatGBP(summary.vatInclusive)} stated as including VAT` : undefined} />
                    {sumPence(unallocated.map((c) => c.amount)) > 0 ? (
                      <Row label="Unallocated" value={formatGBP(sumPence(unallocated.map((c) => c.amount)))} note={`${items(unallocated.length)} to assign`} />
                    ) : null}
                  </dl>
                </Panel>
                <TableWrap>
                  <table className="ledger" data-testid="category-subtotals">
                    <thead><tr><th>Category</th><th className="r">Items</th><th className="r">Amount</th></tr></thead>
                    <tbody>{top.map((r) => <Line key={r.key} r={r} />)}</tbody>
                  </table>
                </TableWrap>
                {rest.length > 0 ? (
                  <details className="mt-3 group">
                    <summary className="cursor-pointer text-sm font-medium text-accent hover:underline">Show all {rows.length} categories</summary>
                    <div className="mt-3">
                      <TableWrap>
                        <table className="ledger">
                          <tbody>{rest.map((r) => <Line key={r.key} r={r} />)}</tbody>
                        </table>
                      </TableWrap>
                    </div>
                  </details>
                ) : null}
              </>
            );
          })()}
        </Section>
      ) : null}

      <nav aria-label="Filter" className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link key={f.key} href={query({ show: f.key })} aria-current={show === f.key ? "page" : undefined}
            className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium", show === f.key ? "bg-ink text-white" : "bg-surface text-ink-soft border border-line-strong hover:bg-sunken")}>
            {f.label}{f.key === "unallocated" && unallocated.length ? ` (${unallocated.length})` : ""}
          </Link>
        ))}
      </nav>

      {visible.length === 0 ? (
        <EmptyState title={show === "unallocated" ? "Nothing is waiting to be assigned" : `No expenses recorded for ${periodLabel(period)}`}>
          {show === "unallocated" ? "Every expense this pay period has been assigned to a driver or counted as a business cost." : "Fuel and expense reports appear here when they are synced or uploaded. You can also add an expense by hand."}
        </EmptyState>
      ) : (
        <TableWrap>
          <table className="ledger [&_td]:!px-2 [&_th]:!px-2 sm:[&_td]:!px-3 sm:[&_th]:!px-3">
            <thead>
              <tr><th>Date</th><th>What</th><th className="hidden sm:table-cell">Supplier</th><th className="hidden sm:table-cell">Vehicle</th>{!ctx.franchise ? <th className="hidden sm:table-cell">Franchise</th> : null}<th>Belongs To</th><th className="r">Amount</th><th className="r hidden sm:table-cell">VAT</th><th /></tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={`${c.kind}-${c.id}`}>
                  <td className="num whitespace-nowrap">
                    {c.kind === "expense" && c.source === "dpd_portal" ? (
                      <>{formatUkDate(c.date)}<span className="block text-xs text-muted">to {formatUkDate(addDays(c.date, 27))}</span></>
                    ) : formatUkDate(c.date)}
                  </td>
                  <td>
                    <span className="font-medium">{c.kind === "fuel" ? "Fuel" : c.categoryName}</span>
                    {c.description ? <span className="block text-sm text-muted">{c.description}{c.litres ? ` · ${c.litres} L` : ""}</span> : c.litres ? <span className="block text-sm text-muted">{c.litres} L</span> : null}
                    {!ctx.franchise ? <span className="block text-sm text-muted sm:hidden">{c.franchiseId ? franchiseName.get(c.franchiseId) : "Franchise not set"}</span> : null}
                    <span className="block text-xs text-muted">{c.importedFileId ? <a href={`/api/files/${c.importedFileId}`} className="hover:underline">{SOURCE_LABEL[c.source] ?? c.source}</a> : (SOURCE_LABEL[c.source] ?? c.source)}{c.reference ? ` · ref ${c.reference}` : ""}</span>
                  </td>
                  <td className="hidden sm:table-cell">{c.supplier ?? "—"}</td>
                  <td className="num hidden sm:table-cell">{c.vehicleRegistration ?? "—"}</td>
                  {!ctx.franchise ? <td className="hidden sm:table-cell">{c.franchiseId ? franchiseName.get(c.franchiseId) : <span className="text-muted">Not set</span>}</td> : null}
                  <td>
                    {c.allocation.scope === "driver" ? (
                      <><Link href={`/drivers/${c.allocation.driverId}`} className="font-medium hover:underline">{names.get(c.allocation.driverId) ?? "Driver"}</Link>
                        <span className="block text-xs text-muted">{c.allocationMethod === "manual" ? "Assigned by you" : (c.allocationNote ?? "Matched automatically")}</span></>
                    ) : c.allocation.scope === "franchise" ? "Business cost" : <Badge tone="warn">Unallocated</Badge>}
                  </td>
                  <td className="r num font-semibold whitespace-nowrap">{formatGBP(c.amount)}</td>
                  <td className="r num hidden sm:table-cell">{c.vat != null ? formatGBP(c.vat) : c.vatBasis === "gross" ? <span className="text-xs text-muted">Included</span> : c.vatBasis === "not_stated" ? <span className="text-xs text-muted">Not stated</span> : <span className="text-muted">—</span>}</td>
                  <td className="r whitespace-nowrap">
                    {ctx.canWrite ? (
                      <span className="inline-flex gap-1">
                        <AssignCostButton kind={c.kind} id={c.id} drivers={drivers} current={c.allocation.scope} summary={`${c.kind === "fuel" ? "Fuel" : c.categoryName} · ${formatGBP(c.amount)} · ${formatUkDate(c.date)}${c.vehicleRegistration ? ` · ${c.vehicleRegistration}` : ""}`} />
                        <ReasonDialog action={voidCost} fields={{ kind: c.kind, id: c.id }} trigger="Remove" title="Remove This Expense From the Totals" submitLabel="Remove"
                          reasonLabel="Why? (for example: duplicate, entered in error)" explanation="The record is kept, marked as void, and no longer counts in any total. This cannot be undone." />
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>Total shown</td><td className="hidden sm:table-cell" /><td className="hidden sm:table-cell" />{!ctx.franchise ? <td className="hidden sm:table-cell" /> : null}<td /><td className="r num whitespace-nowrap">{formatGBP(sumPence(visible.map((c) => c.amount)))}</td><td className="r num hidden sm:table-cell">{visible.some((c) => c.vat != null) ? formatGBP(sumPence(visible.map((c) => c.vat ?? 0))) : ""}</td><td /></tr>
            </tfoot>
          </table>
        </TableWrap>
      )}
    </>
  );
}
