import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storeReadInvoice, unreadablePdfPath } from "@/lib/ingest/invoice-import";
import { parseSelfBilledInvoice } from "@/lib/ingest/invoice";
import { adminClient } from "../helpers/app";
import { createTestAccount, pool, sql, type TestAccount } from "../helpers/db";

const db = adminClient();
let t: TestAccount;
let franchiseId: string;
const BYTES = new TextEncoder().encode("%PDF-1.4\nsynthetic invoice\n%%EOF");
const good = readFileSync("tests/fixtures/dpd-invoice-ocr-garbled-rate.txt", "utf8");
// The same invoice read badly: its Excess parcels line missing, so the lines are short of the total.
const bad = good.replace(/^Excess parcels.*\n/m, "");

beforeAll(async () => {
  t = await createTestAccount("Invoice Recheck");
  // A franchise with the FD number printed on the fixture.
  [{ id: franchiseId }] = await sql<{ id: string }>("insert into public.franchises (account_id, fd_number, name) values ($1, 'FD42102', 'Synthetic West') returning id", [t.accountId]) as [{ id: string }];
}, 60_000);
afterAll(() => pool.end());

describe("an invoice whose lines do not add up", () => {
  it("is stored with its problems, its original kept for the owner, then put right by a later reading", async () => {
    const text = (s: string) => s;
    const input = { accountId: t.accountId, franchiseId, fdNumber: "FD42102", portalInvoiceNo: "FI995046", bytes: BYTES };

    const first = await storeReadInvoice(db, input, parseSelfBilledInvoice(text(bad)), text(bad));
    expect(first).toMatchObject({ status: "stored", reconciled: false, totalsAgree: true, recheck: false });
    const path = unreadablePdfPath(t.accountId, "FD42102", "FI995046");
    expect(first.pdfPath).toBe(path);
    let [doc] = await sql<{ resolved_at: string | null; reason: string; text_path: string | null }>(
      "select resolved_at, reason, text_path from public.unreadable_documents where account_id = $1 and document_no = 'FI995046'", [t.accountId]);
    expect(doc!.resolved_at).toBeNull();
    expect(doc!.reason).toMatch(/lines do not add up/);
    expect(doc!.text_path).not.toBeNull();
    let [row] = await sql<{ reconciled: boolean }>("select reconciled from public.dpd_invoices where account_id = $1 and invoice_no = 'FI995046'", [t.accountId]);
    expect(row!.reconciled).toBe(false);

    // The next night reads it again (with a better reading): the row is replaced and the document drops off the list.
    const second = await storeReadInvoice(db, input, parseSelfBilledInvoice(text(good)), text(good));
    expect(second).toMatchObject({ status: "stored", reconciled: true, recheck: true });
    [row] = await sql<{ reconciled: boolean }>("select reconciled, jsonb_array_length(lines) n from public.dpd_invoices where account_id = $1 and invoice_no = 'FI995046'", [t.accountId]);
    expect(row!.reconciled).toBe(true);
    [doc] = await sql("select resolved_at, reason, text_path from public.unreadable_documents where account_id = $1 and document_no = 'FI995046'", [t.accountId]);
    expect(doc!.resolved_at).not.toBeNull();

    // Once it adds up it is never overwritten, even by a worse reading.
    const third = await storeReadInvoice(db, input, parseSelfBilledInvoice(text(bad)), text(bad));
    expect(third.reconciled).toBe(true);
    [row] = await sql<{ reconciled: boolean }>("select reconciled from public.dpd_invoices where account_id = $1 and invoice_no = 'FI995046'", [t.accountId]);
    expect(row!.reconciled).toBe(true);
    const count = await sql("select 1 from public.dpd_invoices where account_id = $1", [t.accountId]);
    expect(count).toHaveLength(1);
  }, 120_000);
});
