import type { Metadata } from "next";
import { AddScaleRateButton, PasteScaleRatesButton, RemoveScaleRateButton } from "@/components/sliding-scale/forms";
import { Badge, EmptyState, PageHeader, Panel, Section, TableWrap } from "@/components/ui/bits";
import { getContext } from "@/lib/context";
import { fetchAll } from "@/lib/data/fetch-all";

export const metadata: Metadata = { title: "Sliding scale" };

const FUEL_LABEL: Record<string, string> = { diesel: "Diesel", electric: "Electric", other: "Other" };
const range = (from: number | null, to: number | null, unit: string) => (from == null && to == null ? "any" : to == null ? `${from}+ ${unit}` : `${from ?? 0}–${to} ${unit}`);

export default async function SlidingScalePage() {
  const ctx = await getContext();
  const rates = await fetchAll(() =>
    ctx.supabase.from("sliding_scale_rates").select("id, vehicle_type, vehicle_size, fuel_type, stops_from, stops_to, miles_from, miles_to, rate")
      .eq("account_id", ctx.accountId).order("vehicle_type").order("vehicle_size").order("fuel_type").order("stops_from").order("id"),
  );

  // One table per vehicle, size and fuel, as the portal groups them.
  const groups = new Map<string, typeof rates>();
  for (const r of rates) {
    const key = `${r.vehicle_type}|${r.vehicle_size ?? ""}|${r.fuel_type}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return (
    <>
      <PageHeader
        title="Sliding scale"
        description="What DPD pays per stop depends on the vehicle, and on the stops and miles for the day. Copy the bands from the Sliding Scale page in the DPD portal."
        actions={ctx.canWrite ? <div className="flex gap-2"><AddScaleRateButton /><PasteScaleRatesButton /></div> : null}
      />
      {groups.size === 0 ? (
        <EmptyState title="No sliding scale entered yet">Open the Sliding Scale page in the DPD portal and add each band here, one at a time or pasted from a spreadsheet.</EmptyState>
      ) : (
        [...groups.entries()].map(([key, rows]) => {
          const first = rows[0]!;
          return (
            <Section key={key} title={`${first.vehicle_type}${first.vehicle_size ? ` · ${first.vehicle_size}` : ""}`} actions={<Badge tone={first.fuel_type === "electric" ? "good" : "neutral"}>{FUEL_LABEL[first.fuel_type] ?? first.fuel_type}</Badge>}>
              <Panel className="p-0">
                <TableWrap>
                  <table className="ledger">
                    <thead><tr><th>Stops</th><th>Miles</th><th className="r">Rate per stop</th>{ctx.canWrite ? <th /> : null}</tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td className="num">{range(r.stops_from, r.stops_to, "stops")}</td>
                          <td className="num">{range(r.miles_from, r.miles_to, "miles")}</td>
                          <td className="r num">£{Number(r.rate).toFixed(4).replace(/0{1,2}$/, "")}</td>
                          {ctx.canWrite ? <td className="r"><RemoveScaleRateButton id={r.id} /></td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </Panel>
            </Section>
          );
        })
      )}
    </>
  );
}
