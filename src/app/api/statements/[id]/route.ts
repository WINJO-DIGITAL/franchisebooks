import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { statementFileName } from "@/lib/statements/numbering";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Downloads one driver statement PDF. For owners and managers; the statement is found through their own session first. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx.canWrite || !/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const { data: statement } = await ctx.supabase.from("driver_statements").select("storage_path, statement_no, totals").eq("id", id).maybeSingle();
  if (!statement) return new NextResponse("Not found", { status: 404 });
  const file = await createAdminClient().storage.from("reports").download(statement.storage_path);
  if (file.error || !file.data) return new NextResponse("The statement file is no longer available. Make it again from Reports.", { status: 404 });
  const name = statementFileName(statement.statement_no, String((statement.totals as { driverName?: string } | null)?.driverName ?? ""));
  const inline = new URL(request.url).searchParams.get("view") === "1";
  return new NextResponse(file.data, {
    headers: { "content-type": "application/pdf", "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`, "cache-control": "private, no-store" },
  });
}
