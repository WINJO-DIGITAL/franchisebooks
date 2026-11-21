import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/context";
import { loadAdjustments, loadCosts, loadDriverNames, loadPeriodData } from "@/lib/data/period";
import { periodFromParam } from "@/lib/finance/periods";
import { summarisePeriod } from "@/lib/finance/calc";
import { adjustmentLabel, SOURCE_LABEL } from "@/lib/labels";
import { csvMoney, toCsv } from "@/lib/reports/csv";
import { loadStatementRows, wagesToPay } from "@/lib/statements/rows";

export const dynamic = "force-dynamic";

/** CSV downloads for drivers, adjustments and fuel/expenses. Read through the user's own session, so access rules apply. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const ctx = await getContext();
  const period = periodFromParam(request.nextUrl.searchParams.get("period") ?? undefined, ctx.today);
  const { start, end } = period;
  const filter = { accountId: ctx.accountId, from: start, to: end, franchiseId: ctx.franchiseId, hiddenFranchiseIds: ctx.hiddenFranchiseIds };
  const franchises = new Map(ctx.franchises.map((f) => [f.id, f.fdNumber]));
  let header: string[];
  let rows: (string | number | null)[][];

  if (kind === "drivers") {
    const summary = summarisePeriod(await loadPeriodData(ctx.supabase, filter));
    header = ["Franchise", "Driver", "Registered", "Days worked", "Parcels", "Stops", "DPD earnings (GBP)", "Additional payments (GBP)", "Deductions (GBP)", "Final pay (GBP)", "Fuel attributed (GBP)", "Other expenses attributed (GBP)"];
    rows = summary.franchises.filter((f) => f.franchiseId).flatMap((f) =>
      f.drivers.map((d) => [franchises.get(f.franchiseId!) ?? "", d.name, d.registered ? "Yes" : "No", d.daysWorked, d.parcels, d.stops, csvMoney(d.originalEarnings), csvMoney(d.additionalPayments), csvMoney(-d.deductions), csvMoney(d.finalEarnings), csvMoney(d.fuel), csvMoney(d.otherExpenses)]),
    );
  } else if (kind === "adjustments") {
    const [adjustments, names] = await Promise.all([loadAdjustments(ctx.supabase, filter), loadDriverNames(ctx.supabase, ctx.accountId)]);
    header = ["For date", "Franchise", "Driver", "Type", "Amount (GBP)", "Reason", "Reverses entry", "Recorded at (UTC)"];
    rows = adjustments.map((a) => [a.date, franchises.get(a.franchiseId) ?? "", names.get(a.driverId) ?? "", adjustmentLabel(a.type), csvMoney(a.amount), a.reason, a.reversesId ?? "", a.createdAt]);
  } else if (kind === "costs") {
    const [costs, names] = await Promise.all([loadCosts(ctx.supabase, filter), loadDriverNames(ctx.supabase, ctx.accountId)]);
    header = ["Date", "Franchise", "Type", "Category", "Description", "Supplier", "Vehicle", "Reference", "Belongs to", "Source", "Amount (GBP)"];
    rows = costs.map((c) => [
      c.date, c.franchiseId ? (franchises.get(c.franchiseId) ?? "") : "", c.kind === "fuel" ? "Fuel" : "Expense", c.categoryName, c.description ?? "", c.supplier ?? "", c.vehicleRegistration ?? "", c.reference ?? "",
      c.allocation.scope === "driver" ? (names.get(c.allocation.driverId) ?? "Driver") : c.allocation.scope === "franchise" ? "Business cost" : "Unallocated", SOURCE_LABEL[c.source] ?? c.source, csvMoney(c.amount),
    ]);
  } else if (kind === "wages") {
    // Wages to pay: the same figures as the Reports page, one line per driver across all their FD numbers.
    if (!ctx.canWrite) return new NextResponse("Forbidden", { status: 403 });
    const { rows: statementRows } = await loadStatementRows(ctx, period);
    const { data: driverRefs } = await ctx.supabase.from("drivers").select("id, dpd_driver_ref").eq("account_id", ctx.accountId);
    const wages = wagesToPay(statementRows, new Map((driverRefs ?? []).map((d) => [d.id, d.dpd_driver_ref])));
    header = ["DR Number", "Driver", "Franchises", "Amount to pay (GBP)"];
    rows = wages.lines.map((l) => [l.dr ?? "", l.name, l.franchises, l.total == null ? "Incomplete" : csvMoney(l.total)]);
    rows.push(["", "Total", "", wages.complete ? csvMoney(wages.total) : "Incomplete"]);
  } else {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse("﻿" + toCsv(header, rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${kind}-${start}-to-${end}.csv"`, "cache-control": "private, no-store" },
  });
}
