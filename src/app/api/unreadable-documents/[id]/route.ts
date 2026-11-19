import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** How long the signed link to the PDF lasts. Long enough to open it, short enough that a copied link soon stops working. */
export const SIGNED_LINK_SECONDS = 60;

/**
 * Opens the original PDF of a DPD document the sync could not read. Owners only: the record is looked up through the
 * owner's own session (the table only lets owners read it), then the server hands out a short-lived signed link.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  if (!ctx.isOwner || !/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const { data: doc } = await ctx.supabase.from("unreadable_documents").select("document_no, pdf_path").eq("id", id).maybeSingle();
  if (!doc?.pdf_path) return new NextResponse("Not found", { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const signed = await createAdminClient().storage.from("diagnostics")
    .createSignedUrl(doc.pdf_path, SIGNED_LINK_SECONDS, download ? { download: `${doc.document_no}.pdf` } : undefined);
  if (signed.error || !signed.data?.signedUrl) return new NextResponse("The file is no longer available. It will be kept again on the next sync.", { status: 404 });
  return NextResponse.redirect(signed.data.signedUrl, { status: 303, headers: { "cache-control": "private, no-store" } });
}
