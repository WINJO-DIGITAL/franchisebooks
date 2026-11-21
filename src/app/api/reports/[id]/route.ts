import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Downloads a stored monthly report PDF. Access is checked through the user's own session first. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const { data: report } = await ctx.supabase.from("monthly_reports").select("id, storage_path, report_month, totals").eq("id", id).maybeSingle();
  if (!report) return new NextResponse("Not found", { status: 404 });
  // A report with a CSV (the Sliding Scale Discrepancy) is stored beside its PDF under the same name.
  const wantsCsv = new URL(request.url).searchParams.get("format") === "csv";
  const path = wantsCsv ? report.storage_path.replace(/\.pdf$/, ".csv") : report.storage_path;
  const file = await createAdminClient().storage.from("reports").download(path);
  if (file.error || !file.data) return new NextResponse("The report file is no longer available. Generate it again.", { status: 404 });
  const scope = String((report.totals as { scopeLabel?: string } | null)?.scopeLabel ?? "report").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const kind = /\/(driver_pay|profit_loss|discrepancy)-/.exec(report.storage_path)?.[1]?.replace("_", "-") ?? "monthly-report";
  const inline = new URL(request.url).searchParams.get("view") === "1";
  return new NextResponse(file.data, {
    headers: {
      "content-type": wantsCsv ? "text/csv; charset=utf-8" : "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${kind}-${report.report_month.slice(0, 7)}-${scope}.${wantsCsv ? "csv" : "pdf"}"`,
      "cache-control": "private, no-store",
    },
  });
}
