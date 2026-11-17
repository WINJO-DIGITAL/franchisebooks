import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/context";
import { loadAdjustments, loadCosts, loadDriverNames, loadPeriodData } from "@/lib/data/period";
import { isYearMonth, monthRange, monthOf } from "@/lib/dates";
import { summarisePeriod } from "@/lib/finance/calc";
import { adjustmentLabel, SOURCE_LABEL } from "@/lib/labels";
import { csvMoney, toCsv } from "@/lib/reports/csv";

export const dynamic = "force-dynamic";

/** CSV downloads for drivers, adjustments and fuel/expenses. Read through the user's own session, so access rules apply. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const ctx = await getContext();
  const monthParam = request.nextUrl.searchParams.get("month");
  const month = isYearMonth(monthParam) ? monthParam : monthOf(ctx.today);
  const { start, end } = monthRange(month);
  const filter = { accountId: ctx.accountId, from: start, to: end, franchiseId: ctx.franchiseId };
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
      c.allocation.scope === "driver" ? (names.get(c.allocation.driverId) ?? "Driver") : c.allocation.scope === "franchise" ? "Franchise (general)" : "Unallocated", SOURCE_LABEL[c.source] ?? c.source, csvMoney(c.amount),
    ]);
  } else {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse("﻿" + toCsv(header, rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${kind}-${month}.csv"`, "cache-control": "private, no-store" },
  });
}
