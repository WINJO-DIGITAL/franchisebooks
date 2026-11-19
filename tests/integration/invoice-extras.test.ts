import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPeriodData } from "@/lib/data/period";
import { summarisePeriod } from "@/lib/finance/calc";
import { parseSelfBilledInvoice } from "@/lib/ingest/invoice";
import { importDocument } from "@/lib/ingest/pipeline";
import { adminClient } from "../helpers/app";
import { createTestAccount, pool, sql, type TestAccount } from "../helpers/db";

const db = adminClient();
let t: TestAccount;
const invoice = parseSelfBilledInvoice(readFileSync("tests/fixtures/dpd-invoice-ocr.txt", "utf8"))!;
const filter = () => ({ accountId: t.accountId, from: invoice.periodStart, to: invoice.periodEnd, franchiseId: t.franchiseId });

beforeAll(async () => {
  t = await createTestAccount("Invoice Extras");
  const csv = `Franchise: ${t.fdNumber}\nDate,Driver,Route,Parcels,Stops,Gross\n13/10/2026,Alex Example,564,100,80,150.00\n`;
  const out = await importDocument(db, { accountId: t.accountId, source: "manual_upload", filename: "payments.csv", bytes: new Uint8Array(Buffer.from(csv)), uploadedBy: t.ownerId, franchiseHintId: t.franchiseId });
  expect(out.inserted).toBe(1);
}, 60_000);
afterAll(() => pool.end());

async function storeInvoice(invoiceNo: string, reconciled = true) {
  await sql(
    `insert into public.dpd_invoices (account_id, franchise_id, invoice_no, invoice_date, due_date, period_start, period_end, net_total, vat_total, invoice_total, lines, reconciled, problems)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, '[]'::jsonb)`,
    [t.accountId, t.franchiseId, invoiceNo, invoice.invoiceDate, invoice.dueDate, invoice.periodStart, invoice.periodEnd,
      invoice.netTotal / 100, invoice.vatTotal / 100, invoice.invoiceTotal / 100, JSON.stringify(invoice.lines), reconciled],
  );
}

describe("invoice extras in income (stored invoice → loader → totals)", () => {
  it("is daily Payments only before an invoice arrives", async () => {
    const totals = summarisePeriod(await loadPeriodData(db, filter())).combined;
    expect(totals.incomeFromDpd).toBe(15000);
    expect(totals.otherDpdPayments).toBe(0);
  });

  it("adds Fuel Supplement and C&D App once, and never the invoice's stop pay or excess parcels", async () => {
    await storeInvoice("FI-EXTRAS-1");
    const data = await loadPeriodData(db, filter());
    expect(data.otherPayments.map((o) => [o.label, o.amount, o.date])).toEqual([["C&D App", 923, "2026-10-12"], ["Fuel Supplement", 7127, "2026-10-12"]]);
    const totals = summarisePeriod(data).combined;
    expect(totals.otherDpdPayments).toBe(8050);
    expect(totals.incomeFromDpd).toBe(15000 + 8050);
  });

  it("does not count an invoice whose lines could not be read exactly", async () => {
    await sql("update public.dpd_invoices set reconciled = false where account_id = $1", [t.accountId]);
    expect((await loadPeriodData(db, filter())).otherPayments).toEqual([]);
    await sql("update public.dpd_invoices set reconciled = true where account_id = $1", [t.accountId]);
  });
});
