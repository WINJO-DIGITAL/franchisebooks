import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddAssignmentForm, EditDriverForm, EndAssignmentForm } from "@/components/drivers/forms";
import { Badge, EmptyState, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { LinkButton } from "@/components/ui/button";
import { baselineOf, classifyStops, resolveAnomalyConfig, STOP_CONSISTENCY_LABEL, type StopConsistency } from "@/lib/anomalies/detect";
import { franchiseLabel, getContext } from "@/lib/context";
import { loadAdjustments, loadCosts, loadEarnings } from "@/lib/data/period";
import { addDays, addMonths, formatMonth, formatUkDate, formatUkDateLong, monthOf, monthRange } from "@/lib/dates";
import { buildDriverDays, totalAdjustments } from "@/lib/finance/calc";
import { adjustmentLabel } from "@/lib/labels";
import { formatGBP, percentChange, perUnit, sumPence } from "@/lib/money";
import type { Tone } from "@/components/ui/bits";

export const metadata: Metadata = { title: "Driver" };

const CONSISTENCY_TONE: Record<StopConsistency, Tone> = { normal: "neutral", unusual: "warn", missing: "info", discrepancy: "bad", no_history: "neutral" };

export default async function DriverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const { data: driver } = await ctx.supabase.from("drivers").select("id, display_name, dpd_driver_ref, phone, email, start_date, leaving_date, is_active, notes").eq("id", id).maybeSingle();
  if (!driver) notFound();

  const month = monthOf(ctx.today);
  const { start: monthStart } = monthRange(month);
  const historyFrom = monthRange(addMonths(month, -3)).start;
  const filter = { accountId: ctx.accountId, from: historyFrom, to: ctx.today, driverId: id };

  const [assignmentsResult, earnings, adjustments, costs, settings, conflicts] = await Promise.all([
    ctx.supabase.from("driver_assignments").select("id, franchise_id, route, vehicle_registration, start_date, end_date").eq("driver_id", id).order("start_date", { ascending: false }),
    loadEarnings(ctx.supabase, filter),
    loadAdjustments(ctx.supabase, filter),
    loadCosts(ctx.supabase, { accountId: ctx.accountId, from: historyFrom, to: ctx.today }),
    ctx.supabase.from("app_settings").select("anomaly_config").eq("account_id", ctx.accountId).maybeSingle(),
    ctx.supabase.from("review_items").select("payload").eq("kind", "source_conflict").eq("status", "open"),
  ]);
  const assignments = assignmentsResult.data ?? [];
  const config = resolveAnomalyConfig(settings.data?.anomaly_config);
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const names = new Map([[id, driver.display_name]]);

  const days = buildDriverDays(earnings, adjustments, names);
  const monthDays = days.filter((d) => d.date >= monthStart);
  const priorDays = days.filter((d) => d.date < monthStart && d.hasReport);
  const monthOriginal = sumPence(monthDays.map((d) => d.originalEarnings));
  const monthAdjust = totalAdjustments(adjustments.filter((a) => a.date >= monthStart));
  const worked = monthDays.filter((d) => d.hasReport);
  const avgDay = perUnit(monthOriginal, worked.length);
  const priorAvg = perUnit(sumPence(priorDays.map((d) => d.originalEarnings)), priorDays.length);
  const change = avgDay != null && priorAvg != null ? percentChange(priorAvg, avgDay) : null;
  const stops = worked.reduce((n, d) => n + (d.stops ?? 0), 0);
  const parcels = worked.reduce((n, d) => n + (d.parcels ?? 0), 0);
  const myCosts = costs.filter((c) => c.allocation.scope === "driver" && c.allocation.driverId === id);
  const monthCosts = myCosts.filter((c) => c.date >= monthStart);

  // Stop consistency: each day against the driver's own previous working days.
  const conflictDates = new Set(
    (conflicts.data ?? []).map((c) => (c.payload as { incoming?: { driver_id?: string; report_date?: string } } | null)?.incoming).filter((i) => i?.driver_id === id).map((i) => i!.report_date),
  );
  const chronological = [...days].filter((d) => d.hasReport).reverse();
  const consistency = new Map<string, { status: StopConsistency; usual: number | null }>();
  chronological.forEach((day, index) => {
    const history = chronological.slice(Math.max(0, index - config.baselineDays), index).map((d) => d.stops).filter((s): s is number => s != null);
    const baseline = baselineOf(history, config.stopsChangePct, config.minBaselineDays);
    consistency.set(day.date, { status: classifyStops(day.stops, baseline, { hasSourceConflict: conflictDates.has(day.date), minDiff: config.stopsMinDiff }), usual: baseline ? Math.round(baseline.mean) : null });
  });
  const recent = days.filter((d) => d.date >= addDays(ctx.today, -45));
  const activeAssignment = assignments.find((a) => a.start_date <= ctx.today && (!a.end_date || a.end_date >= ctx.today));

  return (
    <>
      <p className="mb-3 text-sm"><Link href="/drivers" className="text-accent hover:underline">← Drivers</Link></p>
      <PageHeader
        title={driver.display_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={driver.is_active ? "good" : "neutral"}>{driver.is_active ? "Active" : "Inactive"}</Badge>
            {activeAssignment ? <span>{franchiseName.get(activeAssignment.franchise_id)}{activeAssignment.route ? ` · Route ${activeAssignment.route}` : ""}</span> : <span>Not currently assigned</span>}
            {driver.leaving_date ? <span>· Left {formatUkDate(driver.leaving_date)}</span> : null}
          </span>
        }
        actions={ctx.canWrite ? (
          <>
            <LinkButton href={`/adjustments/new?driver=${id}`}>Add Pay Adjustment</LinkButton>
            <LinkButton href={`/adjustments/cover?original=${id}`} variant="secondary">Record Driver Cover</LinkButton>
          </>
        ) : null}
      />

      <Section title={formatMonth(month)} description="Month to date">
        <Panel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
            <Stat size="lg" label="Pay after adjustments" value={formatGBP(monthOriginal + monthAdjust.net)} sub={`${formatGBP(monthOriginal)} DPD earnings`} />
            <Stat label="Adjustments" value={monthAdjust.net === 0 ? "None" : formatGBP(monthAdjust.net, { signed: true })} sub={monthAdjust.net === 0 ? undefined : `+${formatGBP(monthAdjust.additionalPayments)} / −${formatGBP(monthAdjust.deductions)}`} />
            <Stat label="Average per working day" value={formatGBP(avgDay)} sub={change == null ? "No earlier history to compare" : `${change > 0 ? "+" : ""}${change}% vs their previous 3 months`} />
            <Stat label="Fuel & expenses" value={formatGBP(sumPence(monthCosts.map((c) => c.amount)))} sub="Attributed to this driver" />
          </div>
          <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
            {worked.length} working day{worked.length === 1 ? "" : "s"} · {stops.toLocaleString("en-GB")} stops · {parcels.toLocaleString("en-GB")} parcels
            {stops > 0 ? ` · ${formatGBP(perUnit(monthOriginal, stops))} per stop · ${(parcels / stops).toFixed(2)} parcels per stop` : ""}
          </p>
        </Panel>
      </Section>

      <Section title="Earnings history" description="Last 45 days. DPD figures are shown exactly as imported; adjustments are separate.">
        {recent.length === 0 ? <EmptyState title="No earnings recorded yet">Earnings appear here once a DPD report naming this driver has been imported.</EmptyState> : (
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr><th>Date</th><th className="r">Parcels</th><th className="r">Stops</th><th>Stop pattern</th><th className="r">DPD earnings</th><th className="r">Adjustments</th><th className="r">Final pay</th></tr>
              </thead>
              <tbody>
                {recent.map((d) => {
                  const c = consistency.get(d.date);
                  return (
                    <tr key={`${d.franchiseId}-${d.date}`}>
                      <td className="num whitespace-nowrap">{formatUkDateLong(d.date)}</td>
                      <td className="r num">{d.parcels ?? "—"}</td>
                      <td className="r num">{d.stops ?? "—"}</td>
                      <td>{d.hasReport && c ? <span className="flex items-center gap-2"><Badge tone={CONSISTENCY_TONE[c.status]}>{STOP_CONSISTENCY_LABEL[c.status]}</Badge>{c.usual != null && c.status === "unusual" ? <span className="text-xs text-muted">usually about {c.usual}</span> : null}</span> : <span className="text-muted">No DPD report</span>}</td>
                      <td className="r num">{d.hasReport ? formatGBP(d.originalEarnings) : "—"}</td>
                      <td className="r num">{d.adjustmentsNet === 0 && d.adjustmentCount === 0 ? "—" : formatGBP(d.adjustmentsNet, { signed: true })}</td>
                      <td className="r num font-medium">{formatGBP(d.finalEarnings)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Pay adjustments" description="Last 3 months" actions={<LinkButton href="/adjustments" variant="quiet" size="sm">All adjustments</LinkButton>}>
        {adjustments.length === 0 ? <EmptyState title="No adjustments" /> : (
          <TableWrap>
            <table className="ledger">
              <thead><tr><th>For date</th><th>Type</th><th>Reason</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {[...adjustments].reverse().map((a) => (
                  <tr key={a.id}>
                    <td className="num whitespace-nowrap">{formatUkDate(a.date)}</td>
                    <td>{adjustmentLabel(a.type)}{a.reversesId ? <Badge className="ml-2">Reversal</Badge> : null}</td>
                    <td className="max-w-md">{a.reason}</td>
                    <td className="r num font-medium">{formatGBP(a.amount, { signed: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Fuel and expenses attributed to this driver" description="Last 3 months">
        {myCosts.length === 0 ? <EmptyState title="Nothing attributed">Costs appear here when they are matched to this driver's vehicle, or when you assign them.</EmptyState> : (
          <TableWrap>
            <table className="ledger">
              <thead><tr><th>Date</th><th>What</th><th>Supplier</th><th>Why it is here</th><th className="r">Amount</th></tr></thead>
              <tbody>
                {[...myCosts].reverse().map((c) => (
                  <tr key={c.id}>
                    <td className="num whitespace-nowrap">{formatUkDate(c.date)}</td>
                    <td>{c.kind === "fuel" ? `Fuel${c.vehicleRegistration ? ` · ${c.vehicleRegistration}` : ""}` : `${c.categoryName}${c.description ? ` · ${c.description}` : ""}`}</td>
                    <td>{c.supplier ?? "—"}</td>
                    <td className="text-sm text-muted">{c.allocationMethod === "manual" ? "Assigned by you" : (c.allocationNote ?? "Matched automatically")}</td>
                    <td className="r num font-medium">{formatGBP(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Franchise and vehicle assignments" actions={ctx.canWrite ? <AddAssignmentForm driverId={id} franchises={ctx.franchises.filter((f) => f.isActive).map((f) => ({ id: f.id, label: franchiseLabel(f) }))} today={ctx.today} /> : null}>
        {assignments.length === 0 ? <EmptyState title="Not assigned to a franchise yet" /> : (
          <TableWrap>
            <table className="ledger">
              <thead><tr><th>Franchise</th><th>Route</th><th>Vehicle</th><th>From</th><th>To</th><th /></tr></thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium">{franchiseName.get(a.franchise_id) ?? "—"}</td>
                    <td>{a.route ?? "—"}</td>
                    <td className="num">{a.vehicle_registration ?? "—"}</td>
                    <td className="num">{formatUkDate(a.start_date)}</td>
                    <td className="num">{a.end_date ? formatUkDate(a.end_date) : <Badge tone="good">Current</Badge>}</td>
                    <td className="r">{ctx.canWrite && !a.end_date ? <EndAssignmentForm id={a.id} driverId={id} today={ctx.today} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      {ctx.canWrite ? (
        <Section title="Driver details">
          <Panel>
            <EditDriverForm driver={{ id, displayName: driver.display_name, dpdDriverRef: driver.dpd_driver_ref, phone: driver.phone, email: driver.email, startDate: driver.start_date, leavingDate: driver.leaving_date, isActive: driver.is_active, notes: driver.notes }} />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}
