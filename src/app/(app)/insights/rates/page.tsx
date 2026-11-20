import type { Metadata } from "next";
import Link from "next/link";
import { InsightsTabs, UpgradeToMax } from "@/components/insights/shell";
import { Badge, EmptyState, PageHeader, Panel, Section, Stat, TableWrap } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import { currentPlan } from "@/lib/billing/plan";
import { franchiseLabel, getContext } from "@/lib/context";
import { fetchAll } from "@/lib/data/fetch-all";
import { periodLabel } from "@/lib/finance/periods";
import { checkStopRates, normaliseFuel, type RateCheckResult, type ScaleBand } from "@/lib/finance/sliding-scale";
import { periodReadStatus } from "@/lib/history/coverage";
import { loadInsights } from "@/lib/history/load";

export const metadata: Metadata = { title: "Rate Checks" };

export default async function RateChecksPage() {
  const ctx = await getContext();
  const scope = ctx.franchise ? franchiseLabel(ctx.franchise) : "All franchises";
  const plan = await currentPlan(ctx.supabase);
  const header = <PageHeader title="Insights" description={`${scope} · Each day's stop rate against the DPD sliding scale, across every period read.`} />;

  if (plan !== "max") {
    return (<>{header}<InsightsTabs active="/insights/rates" /><UpgradeToMax isOwner={ctx.isOwner} feature="Rate Checks" /></>);
  }

  const [data, vehicleRows, scaleRows] = await Promise.all([
    loadInsights(ctx),
    fetchAll(() => ctx.supabase.from("franchises").select("id, vehicle_type, vehicle_size, vehicle_fuel").eq("account_id", ctx.accountId).order("id")),
    fetchAll(() => ctx.supabase.from("sliding_scale_rates").select("vehicle_type, vehicle_size, fuel_type, stops_from, stops_to, miles_from, miles_to, rate").eq("account_id", ctx.accountId).order("id")),
  ]);
  const bands: ScaleBand[] = scaleRows.map((r) => ({
    vehicleType: r.vehicle_type, vehicleSize: r.vehicle_size, fuelType: normaliseFuel(r.fuel_type), stopsFrom: r.stops_from, stopsTo: r.stops_to,
    milesFrom: r.miles_from, milesTo: r.miles_to, rate: Number(r.rate),
  }));
  const franchises = ctx.franchises.filter((f) => data.franchiseIds.includes(f.id));
  const withVehicle = franchises.filter((f) => vehicleRows.find((v) => v.id === f.id)?.vehicle_type);

  const rows: { periodStart: string; label: string; franchise: string; result: RateCheckResult }[] = [];
  if (bands.length > 0) {
    for (const period of data.periods.filter((p) => !p.current)) {
      for (const f of withVehicle) {
        if (periodReadStatus(data.coverage, f.id, period.start) !== "read") continue;
        const vehicle = vehicleRows.find((v) => v.id === f.id)!;
        const days = data.earnings.filter((e) => e.franchiseId === f.id && e.date >= period.start && e.date <= period.end);
        if (days.length === 0) continue;
        rows.push({
          periodStart: period.start,
          label: periodLabel(period),
          franchise: franchiseLabel(f),
          result: checkStopRates(
            days.map((e) => ({ date: e.date, stops: e.stops, miles: e.mileage ?? null, stopPayPence: e.stopPay ?? null })),
            bands,
            { vehicleType: vehicle.vehicle_type!, vehicleSize: vehicle.vehicle_size, fuelType: normaliseFuel(vehicle.vehicle_fuel ?? "diesel") },
          ),
        });
      }
    }
  }
  const differs = rows.reduce((n, r) => n + r.result.differs.length, 0);
  const agreed = rows.reduce((n, r) => n + r.result.agreed, 0);
  const notChecked = rows.reduce((n, r) => n + r.result.notChecked, 0);

  return (
    <>
      {header}
      <InsightsTabs active="/insights/rates" />
      {bands.length === 0 || withVehicle.length === 0 ? (
        <EmptyState
          title="Nothing to Check Against Yet"
          action={<Link href={bands.length === 0 ? "/sliding-scale" : "/settings"} className={buttonClass("secondary", "md")}>{bands.length === 0 ? "Enter the Sliding Scale" : "Set Each Franchise's Vehicle"}</Link>}
        >
          {bands.length === 0
            ? "Enter the sliding scale rates from the DPD portal, and each day's stop rate is checked against them."
            : "Set each franchise's vehicle in Settings, so the right band of the sliding scale is used."}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="No Periods to Check Yet">Periods appear here once DPD has been read for them and they have finished.</EmptyState>
      ) : (
        <>
          <Section title="Across Every Period Read">
            <Panel>
              <div className="grid grid-cols-3 gap-x-6">
                <Stat label="Days paid a different rate" value={differs.toLocaleString("en-GB")} tone={differs > 0 ? "bad" : undefined} />
                <Stat label="Days that matched" value={agreed.toLocaleString("en-GB")} />
                <Stat label="Days not compared" value={notChecked.toLocaleString("en-GB")} sub="Missing stops, miles, or no single band" />
              </div>
            </Panel>
          </Section>
          <Section title="Each Period" description="Newest first. Open a period to see each day that differs.">
            <TableWrap>
              <table className="ledger">
                <thead>
                  <tr><th>Period</th><th>Franchise</th><th>Result</th><th className="r">Matched</th><th className="r">Differ</th><th className="r hidden sm:table-cell">Not Compared</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.periodStart}-${r.franchise}`}>
                      <td className="num whitespace-nowrap">{r.label}</td>
                      <td>{r.franchise}</td>
                      <td>{r.result.differs.length > 0 ? <Badge tone="bad">Rate Differs</Badge> : r.result.agreed > 0 ? <Badge tone="good">All Agree</Badge> : <Badge>Not Compared</Badge>}</td>
                      <td className="r num">{r.result.agreed}</td>
                      <td className="r num">{r.result.differs.length}</td>
                      <td className="r num hidden sm:table-cell">{r.result.notChecked}</td>
                      <td className="r"><Link href={`/check?period=${r.periodStart}`} className="text-sm text-accent hover:underline">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Section>
        </>
      )}
    </>
  );
}
