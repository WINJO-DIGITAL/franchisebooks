import type { Metadata } from "next";
import Link from "next/link";
import { InsightsTabs, UpgradeToMax } from "@/components/insights/shell";
import { Badge, EmptyState, PageHeader, Section, TableWrap } from "@/components/ui/bits";
import { resolveAnomalyConfig } from "@/lib/anomalies/detect";
import { currentPlan } from "@/lib/billing/plan";
import { franchiseLabel, getContext } from "@/lib/context";
import { loadDriverNames } from "@/lib/data/period";
import { formatUkDayMonth } from "@/lib/dates";
import { periodLabel } from "@/lib/finance/periods";
import { driverPerformance, scopeStatus } from "@/lib/history/insights";
import { loadInsights } from "@/lib/history/load";
import { formatGBP } from "@/lib/money";

export const metadata: Metadata = { title: "Driver Performance" };

/** Finished periods shown side by side. */
const PERIODS_SHOWN = 6;

export default async function DriverPerformancePage() {
  const ctx = await getContext();
  const scope = ctx.franchise ? franchiseLabel(ctx.franchise) : "All franchises";
  const plan = await currentPlan(ctx.supabase);
  const header = <PageHeader title="Insights" description={`${scope} · How each driver's stops, parcels and pay have moved from period to period.`} />;

  if (plan !== "max") {
    return (<>{header}<InsightsTabs active="/insights/drivers" /><UpgradeToMax isOwner={ctx.isOwner} feature="Driver Performance" /></>);
  }

  const [data, names, settings] = await Promise.all([
    loadInsights(ctx),
    loadDriverNames(ctx.supabase, ctx.accountId),
    ctx.supabase.from("app_settings").select("anomaly_config").eq("account_id", ctx.accountId).maybeSingle(),
  ]);
  const dropPct = resolveAnomalyConfig(settings.data?.anomaly_config).stopsChangePct;
  // The last few finished periods, oldest first. A period in progress would always look low, so it is left out.
  const periods = data.periods.filter((p) => !p.current).slice(0, PERIODS_SHOWN).reverse()
    .map((p) => ({ ...p, read: ["read", "partly_read"].includes(scopeStatus(data.coverage, data.franchiseIds, p.start)) }));
  const rows = driverPerformance(data.days.filter((d) => data.franchiseIds.includes(d.franchiseId)), periods, dropPct)
    .filter((r) => r.stopsByPeriod.some((s) => s != null && s > 0));
  const nameOf = (key: string, driverId: string | null) =>
    (driverId ? names.get(driverId) : null) ?? data.earnings.find((e) => `unregistered:${e.driverKey}` === key)?.sourceDriverName ?? "Unmatched driver";
  rows.sort((a, b) => Number(b.dropped) - Number(a.dropped) || nameOf(a.key, a.driverId).localeCompare(nameOf(b.key, b.driverId), "en-GB"));
  const latest = periods[periods.length - 1];

  return (
    <>
      {header}
      <InsightsTabs active="/insights/drivers" />
      {rows.length === 0 || !latest ? (
        <EmptyState title="No Driver Figures Yet">They appear once DPD has been read for a finished period with payments in it.</EmptyState>
      ) : (
        <Section
          title={`Last Finished Period: ${periodLabel(latest)}`}
          description={`Stops per working day compared with the period before. A fall of ${dropPct}% or more is marked; you can change that in Settings, under Alert Levels. Stops in earlier periods are shown for comparison, with a dash where the period has not been read.`}
        >
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Driver</th>
                  {periods.map((p) => <th key={p.start} className="r hidden md:table-cell">{formatUkDayMonth(p.start)}</th>)}
                  <th className="r">Days</th><th className="r">Stops</th><th className="r hidden sm:table-cell">Parcels</th>
                  <th className="r">Stops per Day</th><th className="r">Change</th><th className="r hidden sm:table-cell">DPD Pay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="font-medium">
                      {r.driverId ? <Link href={`/drivers/${r.driverId}`} className="hover:underline">{nameOf(r.key, r.driverId)}</Link> : nameOf(r.key, r.driverId)}
                      {r.dropped ? <Badge tone="warn" className="ml-2">Fewer Stops</Badge> : null}
                    </td>
                    {r.stopsByPeriod.map((s, i) => <td key={periods[i]!.start} className="r num hidden md:table-cell">{s == null ? "—" : s.toLocaleString("en-GB")}</td>)}
                    <td className="r num">{r.latest?.days ?? "—"}</td>
                    <td className="r num">{r.latest ? r.latest.stops.toLocaleString("en-GB") : "—"}</td>
                    <td className="r num hidden sm:table-cell">{r.latest ? r.latest.parcels.toLocaleString("en-GB") : "—"}</td>
                    <td className="r num">{r.latest?.stopsPerDay == null ? "—" : r.latest.stopsPerDay.toFixed(1)}</td>
                    <td className="r num">{r.stopsPerDayChange == null ? "—" : `${r.stopsPerDayChange > 0 ? "+" : ""}${r.stopsPerDayChange}%`}</td>
                    <td className="r num hidden sm:table-cell">{r.latest ? formatGBP(r.latest.pay) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      )}
    </>
  );
}
