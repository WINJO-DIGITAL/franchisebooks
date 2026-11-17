import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Downloads the original source document behind any imported figure. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const { data: file } = await ctx.supabase.from("imported_files").select("id, storage_path, original_filename, mime_type").eq("id", id).maybeSingle();
  if (!file?.storage_path) return new NextResponse("Not found", { status: 404 });
  const download = await createAdminClient().storage.from("source-documents").download(file.storage_path);
  if (download.error || !download.data) return new NextResponse("The original file is no longer available.", { status: 404 });
  const safeName = file.original_filename.replace(/[^A-Za-z0-9._ -]+/g, "_");
  return new NextResponse(download.data, {
    headers: {
      "content-type": file.mime_type && /^(application\/pdf|text\/csv)$/.test(file.mime_type) ? file.mime_type : "application/octet-stream",
      "content-disposition": `attachment; filename="${safeName}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
