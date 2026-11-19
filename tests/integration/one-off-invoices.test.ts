import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadOtherPayments } from "@/lib/data/period";
import { parseSelfBilledInvoice } from "@/lib/ingest/invoice";
import { storeReadInvoice } from "@/lib/ingest/invoice-import";
import { adminClient } from "../helpers/app";
import { createTestAccount, pool, sql, type TestAccount } from "../helpers/db";

const db = adminClient();
let t: TestAccount;
let franchiseId: string;
const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, "utf8");
const BYTES = new TextEncoder().encode("%PDF-1.4\nsynthetic\n%%EOF");

beforeAll(async () => {
  t = await createTestAccount("One-off Invoices");
  // The fixtures are printed for FD75486, so this business has a franchise with that number (synthetic, local only).
  [{ id: franchiseId }] = await sql<{ id: string }>("insert into public.franchises (account_id, fd_number, name) values ($1, 'FD75486', 'Synthetic East') returning id", [t.accountId]) as [{ id: string }];
}, 60_000);
afterAll(() => pool.end());

describe("one-off DPD invoices end to end", () => {
  const input = (no: string) => ({ accountId: t.accountId, franchiseId, fdNumber: "FD75486", portalInvoiceNo: no, bytes: BYTES });

  it("stores both, stops listing them as unreadable, and shows one £500 + £100 VAT payment in the right period", async () => {
    // Before this change: both were kept as "could not be read".
    for (const no of ["FI1020123", "FVI17562"]) expect((await storeReadInvoice(db, input(no), null, "")).status).toBe("unreadable");
    expect(await sql("select 1 from public.unreadable_documents where account_id = $1 and resolved_at is null", [t.accountId])).toHaveLength(2);

    // The VAT-only invoice can arrive first: it is stored quietly (nothing to check) and waits for its payment.
    const vat = await storeReadInvoice(db, input("FVI17562"), parseSelfBilledInvoice(fixture("dpd-vat-only-ocr.txt")), "");
    expect(vat).toMatchObject({ status: "stored", reconciled: true, totalsAgree: true });
    expect(await loadOtherPayments(db, { accountId: t.accountId, from: "2026-09-14", to: "2026-10-11" })).toEqual([]);

    const support = await storeReadInvoice(db, input("FI1020123"), parseSelfBilledInvoice(fixture("dpd-support-payment-ocr.txt")), "");
    expect(support).toMatchObject({ status: "stored", reconciled: true, totalsAgree: true });
    expect(support.message).toMatch(/Support payment FI1020123 for FD75486 stored/);

    // Neither is listed as unreadable any more.
    expect(await sql("select 1 from public.unreadable_documents where account_id = $1 and resolved_at is null", [t.accountId])).toHaveLength(0);
    const stored = await sql<{ invoice_no: string; kind: string; period_start: string; net_total: string; vat_total: string }>(
      "select invoice_no, kind, period_start::text, net_total::text, vat_total::text from public.dpd_invoices where account_id = $1 order by invoice_no", [t.accountId]);
    expect(stored).toEqual([
      { invoice_no: "FI1020123", kind: "support_payment", period_start: "2026-09-13", net_total: "500.00", vat_total: "0.00" },
      { invoice_no: "FVI17562", kind: "vat_only", period_start: "2026-10-11", net_total: "0.00", vat_total: "100.00" },
    ]);

    // Pay period 17/08–13/09/2026: one payment, net £500 with £100 VAT.
    const p9 = await loadOtherPayments(db, { accountId: t.accountId, from: "2026-08-17", to: "2026-09-13" });
    expect(p9.map((o) => [o.label, o.amount, o.vat, o.date, o.invoiceNo])).toEqual([["DPD business start support payment", 50000, 10000, "2026-09-13", "FI1020123 + FVI17562"]]);
    // Pay period 14/09–11/10/2026 (the VAT-only invoice's own date): no further income.
    expect(await loadOtherPayments(db, { accountId: t.accountId, from: "2026-09-14", to: "2026-10-11" })).toEqual([]);
  });
});
