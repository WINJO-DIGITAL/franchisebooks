import { NextResponse } from "next/server";
import { getDriverContext } from "@/lib/driver/context";
import { statementFileName } from "@/lib/statements/numbering";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** A driver downloads their own statement. The account and driver come only from their sign-in. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getDriverContext();
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const db = createAdminClient();
  const { data: statement } = await db.from("driver_statements").select("storage_path, statement_no, totals")
    .eq("id", id).eq("account_id", ctx.accountId).eq("driver_id", ctx.driverId).maybeSingle();
  if (!statement) return new NextResponse("Not found", { status: 404 });
  const file = await db.storage.from("reports").download(statement.storage_path);
  if (file.error || !file.data) return new NextResponse("This statement is not available. Ask the office to make it again.", { status: 404 });
  const name = statementFileName(statement.statement_no, String((statement.totals as { driverName?: string } | null)?.driverName ?? ""));
  return new NextResponse(file.data, {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" },
  });
}
