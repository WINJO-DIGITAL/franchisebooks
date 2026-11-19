import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importSelfBilledInvoice, unreadablePdfPath } from "@/lib/ingest/invoice-import";
import { adminClient } from "../helpers/app";
import { addMember, asUser, createTestAccount, pool, sql, type TestAccount } from "../helpers/db";

const db = adminClient();
let t: TestAccount;
// Not a real PDF, so nothing can be read from it: exactly the case where the original must be kept.
const BYTES = new TextEncoder().encode("%PDF-1.4\nnot a readable synthetic document\n%%EOF");

beforeAll(async () => {
  t = await createTestAccount("Unreadable Docs");
}, 60_000);
afterAll(() => pool.end());

describe("DPD documents that cannot be read", () => {
  it("keeps the original PDF privately, once per document, and records it for the owner", async () => {
    const input = { accountId: t.accountId, franchiseId: t.franchiseId, fdNumber: t.fdNumber, portalInvoiceNo: "FVI99001", bytes: BYTES };
    const first = await importSelfBilledInvoice(db, input);
    expect(first.status).toBe("unreadable");
    const path = unreadablePdfPath(t.accountId, t.fdNumber, "FVI99001");
    expect(first.pdfPath).toBe(path);
    // The next night sees the same document again: same file, same row.
    const second = await importSelfBilledInvoice(db, input);
    expect(second.pdfPath).toBe(path);

    const rows = await sql<{ document_no: string; status: string; pdf_path: string; reason: string; resolved_at: string | null }>(
      "select document_no, status, pdf_path, reason, resolved_at from public.unreadable_documents where account_id = $1", [t.accountId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ document_no: "FVI99001", status: "unreadable", pdf_path: path, resolved_at: null });
    expect(rows[0]!.reason).toMatch(/could not be read/);

    const objects = await sql("select name from storage.objects where bucket_id = 'diagnostics' and name = $1", [path]);
    expect(objects).toHaveLength(1);
    const file = await db.storage.from("diagnostics").download(path);
    expect(new Uint8Array(await file.data!.arrayBuffer())).toEqual(BYTES);
    // Never in a bucket anyone can read directly.
    const [bucket] = await sql<{ public: boolean }>("select public from storage.buckets where id = 'diagnostics'");
    expect(bucket!.public).toBe(false);
  }, 120_000);

  it("only the owner can see the list; managers and viewers cannot, and nobody can change it from the app", async () => {
    const manager = await addMember(t.accountId, "manager", "all");
    const viewer = await addMember(t.accountId, "viewer", "all");
    const sees = (user: string) => asUser(user, (run) => run<{ document_no: string }>("select document_no from public.unreadable_documents"));
    expect((await sees(t.ownerId)).map((r) => r.document_no)).toEqual(["FVI99001"]);
    expect(await sees(manager)).toEqual([]);
    expect(await sees(viewer)).toEqual([]);
    // Another business's owner sees nothing of this one.
    const other = await createTestAccount("Other Business");
    expect(await sees(other.ownerId)).toEqual([]);
    await expect(asUser(t.ownerId, (run) => run("update public.unreadable_documents set resolved_at = now()"))).rejects.toThrow();
    await expect(asUser(t.ownerId, (run) => run("delete from public.unreadable_documents"))).rejects.toThrow();
  }, 60_000);
});
