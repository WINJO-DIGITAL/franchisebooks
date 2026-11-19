import type { Metadata } from "next";
import Link from "next/link";
import { LinkDriverForm } from "@/components/drivers/forms";
import { Badge, EmptyState, Notice, PageHeader, Section, TableWrap } from "@/components/ui/bits";
import { buttonClass, LinkButton } from "@/components/ui/button";
import { franchiseLabel, getContext } from "@/lib/context";
import { fetchAll } from "@/lib/data/fetch-all";
import { loadPeriodData } from "@/lib/data/period";
import { formatMonth, formatUkDate, monthOf, monthRange } from "@/lib/dates";
import { summarisePeriod } from "@/lib/finance/calc";
import { formatGBP } from "@/lib/money";

export const metadata: Metadata = { title: "Drivers" };

export default async function DriversPage({ searchParams }: { searchParams: Promise<{ show?: string; q?: string; sort?: string }> }) {
  const { show, q: searchText, sort: sortParam } = await searchParams;
  const ctx = await getContext();
  const month = monthOf(ctx.today);
  const { start } = monthRange(month);

  const [drivers, assignments, data, unregisteredRows] = await Promise.all([
    fetchAll(() => ctx.supabase.from("drivers").select("id, display_name, is_active, start_date, leaving_date, dpd_driver_ref").order("display_name").order("id")),
    fetchAll(() => ctx.supabase.from("driver_assignments").select("id, driver_id, franchise_id, route, vehicle_registration, start_date, end_date").order("start_date", { ascending: false }).order("id")),
    loadPeriodData(ctx.supabase, { accountId: ctx.accountId, from: start, to: ctx.today, franchiseId: ctx.franchiseId }),
    fetchAll(() => {
      let q = ctx.supabase.from("daily_earnings").select("id, franchise_id, driver_key, source_driver_name, report_date").is("driver_id", null).eq("is_current", true).order("report_date", { ascending: false }).order("id");
      if (ctx.franchiseId) q = q.eq("franchise_id", ctx.franchiseId);
      return q;
    }),
  ]);

  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const summary = summarisePeriod(data).combined;
  const routeIncome = summary.earningsMeaning === "route_income";
  // Per driver this month: income (DPD payments), wage (day rate × days) and days worked, across all franchises.
  const byDriver = new Map<string, { income: number; wage: number; wageComplete: boolean; days: number }>();
  for (const d of summary.drivers) {
    if (!d.driverId) continue;
    const e = byDriver.get(d.driverId) ?? { income: 0, wage: 0, wageComplete: true, days: 0 };
    byDriver.set(d.driverId, { income: e.income + d.originalEarnings, wage: e.wage + (d.wage ?? 0), wageComplete: e.wageComplete && d.wageComplete, days: e.days + d.daysWorked });
  }
  const currentRate = (driverId: string) => {
    let best: { from: string; rate: number } | null = null;
    for (const r of data.dayRates ?? []) if (r.driverId === driverId && r.effectiveFrom <= ctx.today && (!best || r.effectiveFrom > best.from)) best = { from: r.effectiveFrom, rate: r.dayRate };
    return best?.rate ?? null;
  };
  const payByDriver = new Map<string, { pay: number; days: number }>();
  for (const d of summary.drivers) {
    if (!d.driverId) continue;
    const existing = payByDriver.get(d.driverId) ?? { pay: 0, days: 0 };
    payByDriver.set(d.driverId, { pay: existing.pay + d.finalEarnings, days: existing.days + d.daysWorked });
  }
  const current = (driverId: string) => assignments.filter((a) => a.driver_id === driverId && a.start_date <= ctx.today && (!a.end_date || a.end_date >= ctx.today));

  const showInactive = show === "all";
  const search = (searchText ?? "").trim().toLowerCase();
  const sort = sortParam === "income" || sortParam === "days" ? sortParam : "name";
  const visible = drivers
    .filter((d) => {
      if (!showInactive && !d.is_active) return false;
      if (search && !d.display_name.toLowerCase().includes(search)) return false;
      if (!ctx.franchiseId) return true;
      return assignments.some((a) => a.driver_id === d.id && a.franchise_id === ctx.franchiseId);
    })
    .sort((a, b) => {
      if (sort === "income") return (byDriver.get(b.id)?.income ?? 0) - (byDriver.get(a.id)?.income ?? 0) || a.display_name.localeCompare(b.display_name, "en-GB");
      if (sort === "days") return (byDriver.get(b.id)?.days ?? 0) - (byDriver.get(a.id)?.days ?? 0) || a.display_name.localeCompare(b.display_name, "en-GB");
      return a.display_name.localeCompare(b.display_name, "en-GB");
    });
  const workedThisMonth = visible.filter((d) => (byDriver.get(d.id)?.days ?? 0) > 0).length;
  const inactiveCount = drivers.filter((d) => !d.is_active).length;

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
        description={`${workedThisMonth} worked in ${formatMonth(month).split(" ")[0]} · ${visible.filter((d) => d.is_active).length} on the books${ctx.franchise ? ` on ${franchiseLabel(ctx.franchise)}` : ""}`}
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
              <option value="income">Income this month</option>
              <option value="days">Days worked this month</option>
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
                  <th className="r">Income</th>
                  <th className="r hidden sm:table-cell">Day Rate</th>
                  <th className="r">Wage</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => {
                  const now = current(d.id);
                  const figures = byDriver.get(d.id);
                  const rate = currentRate(d.id);
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
                      <td className="r num font-medium">{figures ? formatGBP(figures.income) : <span className="text-muted">—</span>}</td>
                      <td className="r num hidden sm:table-cell">{rate == null ? <span className="text-muted">Not set</span> : formatGBP(rate)}</td>
                      <td className="r num">
                        {!figures || figures.days === 0 ? <span className="text-muted">—</span> : figures.wageComplete ? formatGBP(figures.wage) : <Link href={`/drivers/${d.id}`} className="text-accent underline">No rate</Link>}
                      </td>
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
                <th className="r">Days in {formatMonth(month).split(" ")[0]}</th><th className="r">Pay This Month</th>
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
