import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, EmptyState, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { cancelCover, reverseAdjustment } from "@/lib/actions/adjustments";
import { franchiseLabel, getContext } from "@/lib/context";
import { loadAdjustments, loadCovers, loadDriverNames } from "@/lib/data/period";
import { addMonths, formatMonth, formatUkDate, formatUkDateTime, isYearMonth, monthOf, monthRange } from "@/lib/dates";
import { totalAdjustments } from "@/lib/finance/calc";
import { adjustmentLabel } from "@/lib/labels";
import { formatGBP } from "@/lib/money";

export const metadata: Metadata = { title: "Adjustments" };

const EXPENSE_TEXT: Record<string, string> = { original: "stay with the original driver", covering: "count against the covering driver", franchise: "count against the franchise" };

export default async function AdjustmentsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const month = isYearMonth(params.month) ? params.month : monthOf(ctx.today);
  const { start, end } = monthRange(month);
  const filter = { accountId: ctx.accountId, from: start, to: end, franchiseId: ctx.franchiseId };
  const [adjustments, covers, names] = await Promise.all([loadAdjustments(ctx.supabase, filter), loadCovers(ctx.supabase, filter), loadDriverNames(ctx.supabase, ctx.accountId)]);
  const totals = totalAdjustments(adjustments);
  const reversed = new Set(adjustments.filter((a) => a.reversesId).map((a) => a.reversesId as string));
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const showFranchise = !ctx.franchise && ctx.franchises.length > 1;
  const list = [...adjustments].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <PageHeader
        title="Adjustments"
        description="Manual changes to driver pay. The original DPD figures are never altered: every adjustment is a separate, permanent entry."
        actions={ctx.canWrite ? (<><LinkButton href="/adjustments/new">Add Pay Adjustment</LinkButton><LinkButton href="/adjustments/cover" variant="secondary">Record Driver Cover</LinkButton></>) : null}
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link href={`/adjustments?month=${addMonths(month, -1)}`} className={buttonClass("secondary", "sm")} aria-label="Previous month"><ChevronLeft className="size-4" aria-hidden /></Link>
        <span className="min-w-36 text-center font-medium">{formatMonth(month)}</span>
        {addMonths(month, 1) <= monthOf(ctx.today) ? <Link href={`/adjustments?month=${addMonths(month, 1)}`} className={buttonClass("secondary", "sm")} aria-label="Next month"><ChevronRight className="size-4" aria-hidden /></Link> : null}
        <a className={`${buttonClass("quiet", "sm")} ml-auto`} href={`/api/export/adjustments?month=${month}`}>Download spreadsheet</a>
      </div>

      <Section>
        <Panel>
          <div className="grid grid-cols-3 gap-x-6">
            <Stat label="Added to pay" value={formatGBP(totals.additionalPayments)} />
            <Stat label="Taken off pay" value={formatGBP(totals.deductions)} />
            <Stat size="lg" label="Net effect" value={formatGBP(totals.net, { signed: true })} />
          </div>
        </Panel>
      </Section>

      <Section title="Pay adjustments">
        {list.length === 0 ? (
          <EmptyState title={`No adjustments in ${formatMonth(month)}`} />
        ) : (
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr><th>For date</th><th>Driver</th>{showFranchise ? <th>Franchise</th> : null}<th>Type</th><th>Reason</th><th className="r">Amount</th><th>Recorded</th><th /></tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const isReversed = reversed.has(a.id);
                  const canReverse = ctx.canWrite && !a.reversesId && !isReversed && !a.coverRecordId;
                  return (
                    <tr key={a.id} className={a.reversesId || isReversed ? "text-muted" : undefined}>
                      <td className="num whitespace-nowrap">{formatUkDate(a.date)}</td>
                      <td className="font-medium"><Link href={`/drivers/${a.driverId}`} className="hover:underline">{names.get(a.driverId) ?? "Unknown driver"}</Link></td>
                      {showFranchise ? <td>{franchiseName.get(a.franchiseId) ?? ""}</td> : null}
                      <td>
                        {adjustmentLabel(a.type)}
                        {a.reversesId ? <Badge className="ml-2">Reversal</Badge> : null}
                        {isReversed ? <Badge className="ml-2">Reversed</Badge> : null}
                        {a.coverRecordId && !a.reversesId ? <Badge tone="info" className="ml-2">Cover</Badge> : null}
                      </td>
                      <td className="max-w-xs">{a.reason}</td>
                      <td className="r num font-semibold">{formatGBP(a.amount, { signed: true })}</td>
                      <td className="num whitespace-nowrap text-sm text-muted">{formatUkDateTime(a.createdAt)}</td>
                      <td className="r">
                        {canReverse ? (
                          <ReasonDialog
                            action={reverseAdjustment} fields={{ id: a.id }} trigger="Reverse" title="Reverse this adjustment" submitLabel="Reverse adjustment"
                            reasonLabel="Why is it being reversed?"
                            explanation={<>A correcting entry of <strong>{formatGBP(-a.amount, { signed: true })}</strong> will be added for {names.get(a.driverId)}. Both entries stay on record.</>}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Driver cover" description="Who covered whose work, and the pay allocation you agreed.">
        {covers.length === 0 ? <EmptyState title={`No cover recorded in ${formatMonth(month)}`} /> : (
          <TableWrap>
            <table className="ledger">
              <thead><tr><th>Date</th><th>Covered by</th><th>For</th><th>Route</th><th>Pay allocation</th><th>Costs that day</th><th /></tr></thead>
              <tbody>
                {covers.map((c) => (
                  <tr key={c.id} className={c.status === "cancelled" ? "text-muted" : undefined}>
                    <td className="num whitespace-nowrap">{formatUkDate(c.date)}</td>
                    <td className="font-medium">{names.get(c.coveringDriverId) ?? "—"}</td>
                    <td>{names.get(c.originalDriverId) ?? "—"}</td>
                    <td>{c.route ?? "—"}</td>
                    <td className="num">
                      {c.amountToCovering === 0 && c.amountFromOriginal === 0 ? "No pay changes" : (
                        <>{c.amountToCovering ? <span className="block">{formatGBP(c.amountToCovering, { signed: true })} to covering driver</span> : null}
                          {c.amountFromOriginal ? <span className="block">{formatGBP(-c.amountFromOriginal)} from original driver</span> : null}</>
                      )}
                    </td>
                    <td className="text-sm">{EXPENSE_TEXT[c.expenseAttribution]}</td>
                    <td className="r">
                      {c.status === "cancelled" ? <Badge>Cancelled</Badge> : ctx.canWrite ? (
                        <ReasonDialog
                          action={cancelCover} fields={{ id: c.id }} trigger="Cancel" title="Cancel this cover record" submitLabel="Cancel cover record" reasonLabel="Why is it being cancelled?"
                          explanation="Any pay adjustments made by this cover record will be reversed with correcting entries. Nothing is deleted."
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </>
  );
}
