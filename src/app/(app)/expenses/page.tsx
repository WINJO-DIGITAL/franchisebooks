import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AddExpenseButton, AssignCostButton } from "@/components/expenses/forms";
import { Badge, EmptyState, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { cn } from "@/components/ui/cn";
import { buttonClass } from "@/components/ui/button";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { voidCost } from "@/lib/actions/expenses";
import { franchiseLabel, getContext } from "@/lib/context";
import { fetchAll } from "@/lib/data/fetch-all";
import { loadCosts, loadDriverNames } from "@/lib/data/period";
import { addMonths, formatMonth, formatUkDate, isYearMonth, monthOf, monthRange } from "@/lib/dates";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatGBP, sumPence } from "@/lib/money";

export const metadata: Metadata = { title: "Fuel & Expenses" };

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "fuel", label: "Fuel" },
  { key: "other", label: "Other expenses" },
  { key: "unallocated", label: "Unallocated" },
] as const;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string; show?: string; add?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const month = isYearMonth(params.month) ? params.month : monthOf(ctx.today);
  const show = FILTERS.some((f) => f.key === params.show) ? (params.show as (typeof FILTERS)[number]["key"]) : "all";
  const { start, end } = monthRange(month);

  const [costs, names, categories] = await Promise.all([
    loadCosts(ctx.supabase, { accountId: ctx.accountId, from: start, to: end, franchiseId: ctx.franchiseId }),
    loadDriverNames(ctx.supabase, ctx.accountId),
    fetchAll(() => ctx.supabase.from("expense_categories").select("id, name, kind, is_active").eq("is_active", true).order("sort_order").order("id")),
  ]);
  const { data: activeDrivers } = await ctx.supabase.from("drivers").select("id, display_name").eq("is_active", true).order("display_name");
  const drivers = (activeDrivers ?? []).map((d) => ({ id: d.id, label: d.display_name }));
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const isFuel = (c: (typeof costs)[number]) => c.kind === "fuel" || c.categoryKind === "fuel";
  const fuelTotal = sumPence(costs.filter(isFuel).map((c) => c.amount));
  const otherTotal = sumPence(costs.filter((c) => !isFuel(c)).map((c) => c.amount));
  const unallocated = costs.filter((c) => c.allocation.scope === "unallocated");
  const litres = costs.reduce((n, c) => n + (c.litres ?? 0), 0);

  const visible = costs
    .filter((c) => (show === "fuel" ? isFuel(c) : show === "other" ? !isFuel(c) : show === "unallocated" ? c.allocation.scope === "unallocated" : true))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const query = (next: Record<string, string>) => `/expenses?${new URLSearchParams({ month, show, ...next }).toString()}`;

  return (
    <>
      <PageHeader
        title="Fuel & Expenses"
        description={`${formatMonth(month)} · ${ctx.franchise ? franchiseLabel(ctx.franchise) : "All franchises"}`}
        actions={ctx.canWrite ? (
          <AddExpenseButton
            franchises={ctx.franchises.filter((f) => f.isActive).map((f) => ({ id: f.id, label: franchiseLabel(f) }))}
            categories={categories.map((c) => ({ id: c.id, label: c.name }))} drivers={drivers} today={ctx.today} defaultFranchiseId={ctx.franchiseId} startOpen={params.add === "1"}
          />
        ) : null}
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={query({ month: addMonths(month, -1) })} className={buttonClass("secondary", "sm")} aria-label="Previous month"><ChevronLeft className="size-4" aria-hidden /></Link>
        <span className="min-w-36 text-center font-medium">{formatMonth(month)}</span>
        {addMonths(month, 1) <= monthOf(ctx.today) ? <Link href={query({ month: addMonths(month, 1) })} className={buttonClass("secondary", "sm")} aria-label="Next month"><ChevronRight className="size-4" aria-hidden /></Link> : null}
        <a className={`${buttonClass("quiet", "sm")} ml-auto`} href={`/api/export/costs?month=${month}`}>Download spreadsheet</a>
      </div>

      <Section>
        <Panel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
            <Stat size="lg" label="Total costs" value={formatGBP(fuelTotal + otherTotal)} />
            <Stat label="Fuel" value={formatGBP(fuelTotal)} sub={litres > 0 ? `${litres.toLocaleString("en-GB", { maximumFractionDigits: 0 })} litres` : undefined} />
            <Stat label="Other expenses" value={formatGBP(otherTotal)} />
            <Stat label="Unallocated" value={formatGBP(sumPence(unallocated.map((c) => c.amount)))} sub={unallocated.length ? `${unallocated.length} item${unallocated.length === 1 ? "" : "s"} to assign` : "Nothing waiting"} />
          </div>
        </Panel>
      </Section>

      <nav aria-label="Filter" className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link key={f.key} href={query({ show: f.key })} aria-current={show === f.key ? "page" : undefined}
            className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium", show === f.key ? "bg-ink text-white" : "bg-surface text-ink-soft border border-line-strong hover:bg-sunken")}>
            {f.label}{f.key === "unallocated" && unallocated.length ? ` (${unallocated.length})` : ""}
          </Link>
        ))}
      </nav>

      {visible.length === 0 ? (
        <EmptyState title={show === "unallocated" ? "Nothing is waiting to be assigned" : `No costs recorded for ${formatMonth(month)}`}>
          {show === "unallocated" ? "Every cost this month has been assigned to a driver or to the franchise." : "Fuel and expense reports appear here when they are synced or uploaded. You can also add an expense by hand."}
        </EmptyState>
      ) : (
        <TableWrap>
          <table className="ledger">
            <thead>
              <tr><th>Date</th><th>What</th><th>Supplier</th><th>Vehicle</th>{!ctx.franchise ? <th>Franchise</th> : null}<th>Belongs to</th><th className="r">Amount</th><th /></tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={`${c.kind}-${c.id}`}>
                  <td className="num whitespace-nowrap">{formatUkDate(c.date)}</td>
                  <td>
                    <span className="font-medium">{c.kind === "fuel" ? "Fuel" : c.categoryName}</span>
                    {c.description ? <span className="block text-sm text-muted">{c.description}{c.litres ? ` · ${c.litres} L` : ""}</span> : c.litres ? <span className="block text-sm text-muted">{c.litres} L</span> : null}
                    <span className="block text-xs text-muted">{c.importedFileId ? <a href={`/api/files/${c.importedFileId}`} className="hover:underline">{SOURCE_LABEL[c.source] ?? c.source}</a> : (SOURCE_LABEL[c.source] ?? c.source)}{c.reference ? ` · ref ${c.reference}` : ""}</span>
                  </td>
                  <td>{c.supplier ?? "—"}</td>
                  <td className="num">{c.vehicleRegistration ?? "—"}</td>
                  {!ctx.franchise ? <td>{c.franchiseId ? franchiseName.get(c.franchiseId) : <span className="text-muted">Not set</span>}</td> : null}
                  <td>
                    {c.allocation.scope === "driver" ? (
                      <><Link href={`/drivers/${c.allocation.driverId}`} className="font-medium hover:underline">{names.get(c.allocation.driverId) ?? "Driver"}</Link>
                        <span className="block text-xs text-muted">{c.allocationMethod === "manual" ? "Assigned by you" : (c.allocationNote ?? "Matched automatically")}</span></>
                    ) : c.allocation.scope === "franchise" ? "Franchise (general)" : <Badge tone="warn">Unallocated</Badge>}
                  </td>
                  <td className="r num font-semibold">{formatGBP(c.amount)}</td>
                  <td className="r whitespace-nowrap">
                    {ctx.canWrite ? (
                      <span className="inline-flex gap-1">
                        <AssignCostButton kind={c.kind} id={c.id} drivers={drivers} current={c.allocation.scope} summary={`${c.kind === "fuel" ? "Fuel" : c.categoryName} · ${formatGBP(c.amount)} · ${formatUkDate(c.date)}${c.vehicleRegistration ? ` · ${c.vehicleRegistration}` : ""}`} />
                        <ReasonDialog action={voidCost} fields={{ kind: c.kind, id: c.id }} trigger="Remove" title="Remove this cost from the totals" submitLabel="Remove"
                          reasonLabel="Why? (for example: duplicate, entered in error)" explanation="The record is kept, marked as void, and no longer counts in any total. This cannot be undone." />
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={!ctx.franchise ? 6 : 5}>Total shown</td><td className="r num">{formatGBP(sumPence(visible.map((c) => c.amount)))}</td><td /></tr>
            </tfoot>
          </table>
        </TableWrap>
      )}
    </>
  );
}
