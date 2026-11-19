import { zipSync } from "fflate";
import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { isISODate } from "@/lib/dates";
import { statementFileName } from "@/lib/statements/numbering";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Every driver statement for one pay period as a single zip file, for owners and managers. Only the statements their own
 * session can see are included (so a manager gets just their franchises). ?period=<start date>&franchise=<id, optional>
 */
export async function GET(request: Request) {
  const ctx = await getContext();
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "";
  const franchise = url.searchParams.get("franchise");
  if (!ctx.canWrite || !isISODate(period) || (franchise && !/^[0-9a-f-]{36}$/.test(franchise))) return new NextResponse("Not found", { status: 404 });
  let q = ctx.supabase.from("driver_statements").select("storage_path, statement_no, totals").eq("period_start", period).order("statement_no");
  if (franchise) q = q.eq("franchise_id", franchise);
  const { data: statements } = await q;
  if (!statements?.length) return new NextResponse("There are no driver statements for that period yet.", { status: 404 });

  const admin = createAdminClient();
  const files: Record<string, Uint8Array> = {};
  for (const s of statements) {
    const file = await admin.storage.from("reports").download(s.storage_path);
    if (file.error || !file.data) continue;
    files[statementFileName(s.statement_no, String((s.totals as { driverName?: string } | null)?.driverName ?? ""))] = new Uint8Array(await file.data.arrayBuffer());
  }
  if (Object.keys(files).length === 0) return new NextResponse("The statement files are no longer available. Make them again from Reports.", { status: 404 });
  // PDFs are already compressed, so they are stored as they are.
  const zip = zipSync(files, { level: 0 });
  return new NextResponse(Buffer.from(zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="driver-statements-${period}.zip"`, "cache-control": "private, no-store" },
  });
}
