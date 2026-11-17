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
  const file = await createAdminClient().storage.from("reports").download(report.storage_path);
  if (file.error || !file.data) return new NextResponse("The report file is no longer available. Generate it again.", { status: 404 });
  const scope = String((report.totals as { scopeLabel?: string } | null)?.scopeLabel ?? "report").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const inline = new URL(request.url).searchParams.get("view") === "1";
  return new NextResponse(file.data, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="monthly-report-${report.report_month.slice(0, 7)}-${scope}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
