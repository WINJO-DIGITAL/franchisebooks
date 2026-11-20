import type { Metadata } from "next";
import Link from "next/link";
import { UpgradeToMax } from "@/components/insights/shell";
import { Badge, EmptyState, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import { currentPlan } from "@/lib/billing/plan";
import { franchiseLabel, getContext } from "@/lib/context";
import { fetchAll } from "@/lib/data/fetch-all";
import { formatUkDate, isISODate } from "@/lib/dates";
import { buildDiscrepancyReport, dailyFromRows, NOT_COMPARED_TEXT, TOLERANCE_PER_STOP, type DayOutcome } from "@/lib/finance/discrepancy";
import { periodContaining, lastCompletedPeriod, periodLabel, recentPeriods } from "@/lib/finance/periods";
import { normaliseFuel, type ScaleBand } from "@/lib/finance/sliding-scale";
import { loadEarnings } from "@/lib/data/period";
import { formatGBP } from "@/lib/money";

export const metadata: Metadata = { title: "Sliding Scale Report" };

const pence = (value: number) => formatGBP(Math.abs(value));

function outcomeRow(o: DayOutcome) {
  if (o.kind === "not_compared") return { label: "Not Compared", tone: "neutral" as const, paid: "—", expected: "—", difference: "—", note: NOT_COMPARED_TEXT[o.reason] };
  const perStop = (v: number) => `£${v.toFixed(2)}`;
  if (o.kind === "agrees") return { label: "Agrees", tone: "good" as const, paid: perStop(o.paidPerStop), expected: perStop(o.expectedPerStop), difference: "—", note: "" };
  const under = o.kind === "underpaid";
  return {
    label: under ? "Underpaid" : "Overpaid",
    tone: under ? ("bad" as const) : ("warn" as const),
    paid: perStop(o.paidPerStop),
    expected: perStop(o.expectedPerStop),
    difference: `${under ? "−" : "+"}${pence(o.differencePence)}`,
    note: "",
  };
}

export default async function ScaleReportPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const plan = await currentPlan(ctx.supabase);
  const header = <PageHeader title="Sliding Scale Report" description="Each day's stop pay checked against the sliding scale you have entered, in both directions." />;

  if (plan !== "max") {
    return (<>{header}<UpgradeToMax isOwner={ctx.isOwner} /></>);
  }

  const period = isISODate(params.period) ? periodContaining(params.period) : lastCompletedPeriod(ctx.today);
  const choices = recentPeriods(ctx.today, 8).filter((p) => p.end <= ctx.today);
  const franchises = (ctx.franchise ? [ctx.franchise] : ctx.franchises.filter((f) => f.isActive));

  const [earnings, vehicleRows, scaleRows] = await Promise.all([
    loadEarnings(ctx.supabase, { accountId: ctx.accountId, from: period.start, to: period.end, franchiseId: ctx.franchiseId, hiddenFranchiseIds: ctx.hiddenFranchiseIds }),
    fetchAll(() => ctx.supabase.from("franchises").select("id, vehicle_type, vehicle_size, vehicle_fuel").eq("account_id", ctx.accountId).order("id")),
    fetchAll(() => ctx.supabase.from("sliding_scale_rates").select("vehicle_type, vehicle_size, fuel_type, stops_from, stops_to, miles_from, miles_to, rate").eq("account_id", ctx.accountId).order("id")),
  ]);
  const bands: ScaleBand[] = scaleRows.map((r) => ({
    vehicleType: r.vehicle_type, vehicleSize: r.vehicle_size, fuelType: normaliseFuel(r.fuel_type), stopsFrom: r.stops_from, stopsTo: r.stops_to,
    milesFrom: r.miles_from, milesTo: r.miles_to, rate: Number(r.rate),
  }));
  const daily = dailyFromRows(earnings.map((e) => ({ franchiseId: e.franchiseId, date: e.date, stops: e.stops, mileage: e.mileage ?? null, stopPayPence: e.stopPay ?? null })));

  const sections = franchises.map((f) => {
    const vehicle = vehicleRows.find((v) => v.id === f.id);
    if (!vehicle?.vehicle_type) return { f, kind: "no_vehicle" as const };
    if (bands.length === 0) return { f, kind: "no_scale" as const };
    const report = buildDiscrepancyReport(daily.get(f.id) ?? [], bands, {
      vehicleType: vehicle.vehicle_type,
      vehicleSize: vehicle.vehicle_size,
      fuelType: normaliseFuel(vehicle.vehicle_fuel ?? "diesel"),
    });
    return { f, kind: "report" as const, report };
  });

  return (
    <>
      {header}
      <nav aria-label="Periods" className="mb-6 flex flex-wrap gap-2">
        {choices.map((p) => (
          <Link key={p.start} href={`/reports/scale?period=${p.start}`} aria-current={p.start === period.start ? "page" : undefined}
            className={buttonClass(p.start === period.start ? "primary" : "secondary", "sm")}>{periodLabel(p)}</Link>
        ))}
      </nav>

      {sections.length === 0 ? (
        <EmptyState title="No Franchises Yet">Add a franchise, its vehicle, and the sliding scale to check its pay.</EmptyState>
      ) : sections.map((s) => {
        if (s.kind === "no_vehicle") return (
          <Section key={s.f.id} title={franchiseLabel(s.f)}>
            <EmptyState title="Set This Franchise's Vehicle">Set its vehicle in Settings, so the right band of the sliding scale is used.</EmptyState>
          </Section>
        );
        if (s.kind === "no_scale") return (
          <Section key={s.f.id} title={franchiseLabel(s.f)}>
            <EmptyState title="Enter the Sliding Scale">Copy the bands from the Sliding Scale page in the DPD portal, and each day&rsquo;s pay is checked against them.</EmptyState>
            <div className="mt-4 flex justify-center"><Link href="/sliding-scale" className={buttonClass("secondary", "md")}>Open Sliding Scale</Link></div>
          </Section>
        );
        const t = s.report.totals;
        return (
          <Section key={s.f.id} title={`${franchiseLabel(s.f)} · ${periodLabel(period)}`}
            description={`Compared against the scale entered. A day counts as agreeing when the rate paid is within ${Math.round(TOLERANCE_PER_STOP * 100)}p a stop of the scale.`}>
            <Panel>
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
                <Stat label="Days Underpaid" value={String(t.underpaidDays)} sub={t.underpaidDays ? formatGBP(t.underpaidPence) : undefined} tone={t.underpaidDays ? "bad" : undefined} />
                <Stat label="Days Overpaid" value={String(t.overpaidDays)} sub={t.overpaidDays ? formatGBP(t.overpaidPence) : undefined} />
                <Stat label="Days Agreeing" value={String(t.agreedDays)} />
                <Stat label="Not Compared" value={String(t.notComparedDays)} sub="Missing stops, stop pay, or no single band" />
              </div>
            </Panel>
            {s.report.ordered.length === 0 ? (
              <div className="mt-4"><EmptyState title="No Days in This Period">Nothing was read for this period yet.</EmptyState></div>
            ) : (
              <div className="mt-4">
                <TableWrap>
                  <table className="ledger">
                    <thead>
                      <tr><th>Date</th><th>Result</th><th className="r">Stops</th><th className="r">Paid per Stop</th><th className="r">Scale per Stop</th><th className="r">Difference</th><th className="hidden md:table-cell">Note</th></tr>
                    </thead>
                    <tbody>
                      {s.report.ordered.map((o) => {
                        const row = outcomeRow(o);
                        return (
                          <tr key={`${o.date}-${o.kind}`}>
                            <td className="num whitespace-nowrap">{formatUkDate(o.date)}</td>
                            <td><Badge tone={row.tone}>{row.label}</Badge></td>
                            <td className="r num">{o.kind === "not_compared" ? "—" : o.stops}</td>
                            <td className="r num">{row.paid}</td>
                            <td className="r num">{row.expected}</td>
                            <td className="r num font-medium">{row.difference}</td>
                            <td className="hidden text-sm text-muted md:table-cell">{row.note}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
                <p className="mt-3 text-xs text-muted">This report shows DPD&rsquo;s stated figures checked against the scale entered for this franchise. It is not a claim about what DPD owes; questions about pay should be taken to DPD.</p>
              </div>
            )}
          </Section>
        );
      })}
    </>
  );
}
