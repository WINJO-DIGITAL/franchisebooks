import type { Metadata } from "next";
import Link from "next/link";
import { DatesPanel, type DateRow } from "@/components/drivers/dates-panel";
import { LinkDriverForm } from "@/components/drivers/forms";
import { Badge, EmptyState, Notice, PageHeader, Section, TableWrap } from "@/components/ui/bits";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { franchiseLabel, getContext } from "@/lib/context";
import { fetchAll } from "@/lib/data/fetch-all";
import { loadPeriodData, hiddenFranchiseFilter } from "@/lib/data/period";
import { formatUkDate } from "@/lib/dates";
import { periodContaining, periodLabel } from "@/lib/finance/periods";
import { summarisePeriod } from "@/lib/finance/calc";
import { formatGBP } from "@/lib/money";

export const metadata: Metadata = { title: "Drivers" };

export default async function DriversPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string; sort?: string }> }) {
  const { show, q: searchText, sort: sortParam } = await searchParams;
  const ctx = await getContext();
  const period = periodContaining(ctx.today);
  const { start } = period;
  // The dates table is added by a migration: until it has been run the page shows no dates rather than failing.
  const [datesResult, names] = await Promise.all([
    ctx.supabase.from("compliance_dates").select("id, subject_type, driver_id, vehicle_registration, kind, label, expires_on, notes").order("expires_on").order("id"),
    fetchAll(() => ctx.supabase.from("drivers").select("id, display_name").order("display_name").order("id")),
  ]);
  const dateRecords = datesResult.error ? [] : (datesResult.data ?? []);
  const driverName = new Map(names.map((d) => [d.id, d.display_name]));
  const dateRows: DateRow[] = dateRecords.map((r) => ({
    id: r.id,
    subjectType: r.subject_type as "driver" | "vehicle",
    subject: r.subject_type === "driver" ? (driverName.get(r.driver_id ?? "") ?? "Unknown driver") : (r.vehicle_registration ?? ""),
    kind: r.kind,
    label: r.label,
    expiresOn: r.expires_on,
    notes: r.notes,
  }));

  const [drivers, assignments, data, workedRows, unregisteredRows] = await Promise.all([
    fetchAll(() => ctx.supabase.from("drivers").select("id, display_name, is_active, start_date, leaving_date, dpd_driver_ref").order("display_name").order("id")),
    fetchAll(() => ctx.supabase.from("driver_assignments").select("id, driver_id, franchise_id, route, vehicle_registration, start_date, end_date").order("start_date", { ascending: false }).order("id")),
    loadPeriodData(ctx.supabase, { accountId: ctx.accountId, from: start, to: ctx.today, franchiseId: ctx.franchiseId, hiddenFranchiseIds: ctx.hiddenFranchiseIds }),
    // Every driver who has ever had a day read from DPD, in any period. An inactive driver with none is left off the list.
    fetchAll(() => ctx.supabase.from("daily_earnings").select("driver_id").eq("account_id", ctx.accountId).eq("is_current", true).not("driver_id", "is", null).order("id")),
    fetchAll(() => {
      let q = ctx.supabase.from("daily_earnings").select("id, franchise_id, driver_key, source_driver_name, report_date").is("driver_id", null).eq("is_current", true).order("report_date", { ascending: false }).order("id");
      if (ctx.franchiseId) q = q.eq("franchise_id", ctx.franchiseId);
      const hiddenFilter = hiddenFranchiseFilter(ctx);
      if (hiddenFilter) q = q.or(hiddenFilter);
      return q;
    }),
  ]);

  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const summary = summarisePeriod(data).combined;
  const routeIncome = summary.earningsMeaning === "route_income";
  // Per driver this pay period: income (DPD payments), wage (day rate × days) and days worked, across all franchises.
  const byDriver = new Map<string, { days: number; stops: number; parcels: number }>();
  for (const d of summary.drivers) {
    if (!d.driverId) continue;
    const e = byDriver.get(d.driverId) ?? { days: 0, stops: 0, parcels: 0 };
    byDriver.set(d.driverId, { days: e.days + d.daysWorked, stops: e.stops + d.stops, parcels: e.parcels + d.parcels });
  }
  const payByDriver = new Map<string, { pay: number; days: number }>();
  for (const d of summary.drivers) {
    if (!d.driverId) continue;
    const existing = payByDriver.get(d.driverId) ?? { pay: 0, days: 0 };
    payByDriver.set(d.driverId, { pay: existing.pay + d.finalEarnings, days: existing.days + d.daysWorked });
  }
  const current = (driverId: string) => assignments.filter((a) => a.driver_id === driverId && a.start_date <= ctx.today && (!a.end_date || a.end_date >= ctx.today));

  const everWorked = new Set(workedRows.map((r) => r.driver_id as string));
  // An inactive driver who has never done a day is not listed, so the list shows only people who have worked.
  const listable = (d: { id: string; is_active: boolean }) => d.is_active || everWorked.has(d.id);
  const showInactive = show === "all";
  const search = (searchText ?? "").trim().toLowerCase();
  const sort = sortParam === "stops" || sortParam === "days" ? sortParam : "name";
  const visible = drivers
    .filter((d) => {
      if (!listable(d)) return false;
      if (!showInactive && !d.is_active) return false;
      if (search && !d.display_name.toLowerCase().includes(search)) return false;
      if (!ctx.franchiseId) return true;
      return assignments.some((a) => a.driver_id === d.id && a.franchise_id === ctx.franchiseId);
    })
    .sort((a, b) => {
      if (sort === "stops") return (byDriver.get(b.id)?.stops ?? 0) - (byDriver.get(a.id)?.stops ?? 0) || a.display_name.localeCompare(b.display_name, "en-GB");
      if (sort === "days") return (byDriver.get(b.id)?.days ?? 0) - (byDriver.get(a.id)?.days ?? 0) || a.display_name.localeCompare(b.display_name, "en-GB");
      return a.display_name.localeCompare(b.display_name, "en-GB");
    });
  const workedThisPeriod = visible.filter((d) => (byDriver.get(d.id)?.days ?? 0) > 0).length;
  const inactiveCount = drivers.filter((d) => !d.is_active && everWorked.has(d.id)).length;

  const unregistered = new Map<string, { franchiseId: string; driverKey: string; name: string; days: number; latest: string }>();
  for (const row of unregisteredRows) {
    const key = `${row.franchise_id}|${row.driver_key}`;
    const existing = unregistered.get(key);
    if (existing) existing.days += 1;
    else unregistered.set(key, { franchiseId: row.franchise_id, driverKey: row.driver_key, name: row.source_driver_name, days: 1, latest: row.report_date });
  }

  return (
    <>
      <PageHeader
        title="Drivers"
        description={`${workedThisPeriod} worked in ${periodLabel(period)} · ${visible.filter((d) => d.is_active).length} on the books${ctx.franchise ? ` on ${franchiseLabel(ctx.franchise)}` : ""}`}
        actions={ctx.canWrite ? <LinkButton href="/drivers/new">Add Driver</LinkButton> : null}
      />

      {unregistered.size > 0 ? (
        <Section title="Names on DPD Reports That Are Not Registered" description="Their earnings are counted in the franchise totals, but cannot be attributed to a person until you say who they are.">
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr><th>Name on the Report</th><th>Franchise</th><th className="r">Report Days</th><th>Most Recent</th><th /></tr>
              </thead>
              <tbody>
                {[...unregistered.values()].map((u) => (
                  <tr key={`${u.franchiseId}|${u.driverKey}`}>
                    <td className="font-medium">{u.name}</td>
                    <td>{franchiseName.get(u.franchiseId) ?? ""}</td>
                    <td className="r num">{u.days}</td>
                    <td className="num">{formatUkDate(u.latest)}</td>
                    <td className="r">{ctx.canWrite ? <LinkDriverForm franchiseId={u.franchiseId} driverKey={u.driverKey} sourceName={u.name} drivers={drivers.filter((d) => d.is_active).map((d) => ({ id: d.id, label: d.display_name }))} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      ) : null}

      <Section id="dates" title="Driver and Vehicle Dates" description="Expiry dates to be reminded of: a driver's licence, right to work or DBS check, and a van's MOT, service, road tax or insurance. These are reminders only and change no pay.">
        <DatesPanel
          rows={dateRows}
          drivers={drivers.filter((d) => d.is_active).map((d) => ({ id: d.id, name: d.display_name }))}
          today={ctx.today}
          canWrite={ctx.canWrite}
        />
      </Section>

      {visible.length === 0 ? (
        <EmptyState title="No Drivers Yet" action={ctx.canWrite ? <LinkButton href="/drivers/new">Add Your First Driver</LinkButton> : undefined}>
          Add your drivers so that earnings, adjustments and expenses can be attributed to the right person.
        </EmptyState>
      ) : routeIncome ? (
        <>
          <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
            {showInactive ? <input type="hidden" name="show" value="all" /> : null}
            <label className="sr-only" htmlFor="driver-search">Search drivers</label>
            <input id="driver-search" name="q" defaultValue={searchText ?? ""} placeholder="Search by name" className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 text-base" />
            <label className="sr-only" htmlFor="driver-sort">Sort by</label>
            <select id="driver-sort" name="sort" defaultValue={sort} className="h-10 rounded-lg border border-line-strong bg-surface px-2 text-sm">
              <option value="name">Name</option>
              <option value="stops">Stops this pay period</option>
              <option value="days">Days worked this pay period</option>
            </select>
            <button type="submit" className={buttonClass("secondary", "sm")}>Apply</button>
          </form>
          <TableWrap>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th className="hidden sm:table-cell">Franchise</th>
                  <th className="hidden sm:table-cell">Route</th>
                  <th className="r">Days</th>
                  <th className="r">Stops</th>
                  <th className="r">Parcels</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => {
                  const now = current(d.id);
                  const figures = byDriver.get(d.id);
                  const where = now.length ? now.map((a) => [franchiseName.get(a.franchise_id) ?? "—", a.route].filter(Boolean).join(" · route ")).join(", ") : "";
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/drivers/${d.id}`} className="font-medium hover:underline">{d.display_name}</Link>
                        {!d.is_active ? <Badge className="ml-2">Inactive</Badge> : null}
                        {where ? <span className="mt-0.5 block text-sm text-muted sm:hidden">{where}</span> : null}
                      </td>
                      <td className="hidden sm:table-cell">{now.length ? now.map((a) => franchiseName.get(a.franchise_id) ?? "—").join(", ") : <span className="text-muted">Not assigned</span>}</td>
                      <td className="num hidden sm:table-cell">{now.map((a) => a.route).filter(Boolean).join(" / ") || <span className="text-muted">—</span>}</td>
                      <td className="r num">{figures?.days ?? 0}</td>
                      <td className="r num">{figures ? figures.stops.toLocaleString("en-GB") : <span className="text-muted">—</span>}</td>
                      <td className="r num">{figures ? figures.parcels.toLocaleString("en-GB") : <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </>
      ) : (
        <TableWrap>
          <table className="ledger">
            <thead>
              <tr>
                <th>Driver</th><th>Franchise</th><th>Route</th><th>Vehicle</th>
                <th className="r">Days This Period</th><th className="r">Pay This Period</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => {
                const now = current(d.id);
                const pay = payByDriver.get(d.id);
                return (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/drivers/${d.id}`} className="font-medium hover:underline">{d.display_name}</Link>
                      {!d.is_active ? <Badge className="ml-2">Inactive</Badge> : null}
                    </td>
                    <td>{now.length ? now.map((a) => franchiseName.get(a.franchise_id) ?? "—").join(", ") : <span className="text-muted">Not assigned</span>}</td>
                    <td>{now.map((a) => a.route).filter(Boolean).join(" / ") || <span className="text-muted">—</span>}</td>
                    <td className="num">{now.map((a) => a.vehicle_registration).filter(Boolean).join(" / ") || <span className="text-muted">—</span>}</td>
                    <td className="r num">{pay?.days ?? 0}</td>
                    <td className="r num font-medium">{pay ? formatGBP(pay.pay) : <span className="text-muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}

      {inactiveCount > 0 ? (
        <p className="mt-4 text-sm">
          <Link href={showInactive ? "/drivers" : "/drivers?show=all"} className="font-medium text-accent hover:underline">
            {showInactive ? "Hide inactive drivers" : `Show ${inactiveCount} inactive driver${inactiveCount === 1 ? "" : "s"}`}
          </Link>
        </p>
      ) : null}
      {ctx.franchises.length === 0 ? <Notice tone="info" className="mt-6" title="Add a Franchise First">Drivers are assigned to franchises. Add your FD number in <Link href="/settings" className="text-accent underline">Settings</Link>.</Notice> : null}
    </>
  );
}
