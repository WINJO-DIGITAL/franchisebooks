/**
 * Stores one DPD self-billed invoice (a PDF from the portal's Invoices page) in dpd_invoices.
 *
 * The invoice's own arithmetic decides whether it is trusted: "reconciled" means its lines add up to its net total.
 * Only reconciled invoices count as income. An unreadable or unreconciled invoice is still stored with its problems,
 * so it can be checked rather than silently dropped.
 */

import { readSelfBilledInvoicePdf } from "./invoice-pdf";
import type { ParsedInvoice } from "./invoice";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";

export type InvoiceStatus = "stored" | "unreadable" | "wrong_franchise" | "incomplete";

export interface InvoiceImportOutcome {
  status: InvoiceStatus;
  invoiceNo: string | null;
  reconciled: boolean;
  message: string;
}

/** Decides what a parsed invoice means for the franchise it was downloaded for. Pure, so it is testable without the portal. */
export function classifyInvoice(invoice: ParsedInvoice | null, franchiseFd: string): InvoiceStatus {
  if (!invoice) return "unreadable";
  if (!invoice.periodStart || !invoice.periodEnd || !invoice.invoiceDate) return "incomplete";
  if (invoice.fdNumber !== franchiseFd) return "wrong_franchise";
  return "stored";
}

/**
 * Stores an invoice keyed by the number the portal lists for it (the link's row), not by the number read from the PDF:
 * the portal's list is what the next night's run checks against, so the two must agree.
 */
export async function importSelfBilledInvoice(
  db: AdminClient,
  input: { accountId: string; franchiseId: string; fdNumber: string; portalInvoiceNo: string; bytes: Uint8Array },
): Promise<InvoiceImportOutcome> {
  const { invoice } = await readSelfBilledInvoicePdf(input.bytes);
  const status = classifyInvoice(invoice, input.fdNumber);
  const invoiceNo = input.portalInvoiceNo;
  const problems = [...(invoice?.problems ?? [])];
  if (invoice && invoice.invoiceNo !== invoiceNo) problems.push(`The portal lists this invoice as ${invoiceNo}, but the PDF reads as ${invoice.invoiceNo}. Check the number.`);

  if (!invoice || status !== "stored") {
    const message = status === "wrong_franchise"
      ? `Invoice ${invoiceNo} is for ${invoice?.fdNumber}, not ${input.fdNumber}, so it was not stored.`
      : `Invoice ${invoiceNo} for ${input.fdNumber} could not be read, so it was not stored. It will be tried again tomorrow.`;
    return { status, invoiceNo, reconciled: false, message };
  }

  const { error } = await db.from("dpd_invoices").upsert(
    {
      account_id: input.accountId,
      franchise_id: input.franchiseId,
      invoice_no: invoiceNo,
      invoice_date: invoice.invoiceDate,
      due_date: invoice.dueDate,
      period_start: invoice.periodStart,
      period_end: invoice.periodEnd,
      net_total: invoice.netTotal / 100,
      vat_total: invoice.vatTotal / 100,
      invoice_total: invoice.invoiceTotal / 100,
      lines: invoice.lines as unknown as JsonObject[],
      reconciled: invoice.reconciled && invoice.invoiceNo === invoiceNo,
      problems: problems as unknown as JsonObject[],
    },
    { onConflict: "account_id,invoice_no", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Could not store invoice ${invoiceNo}: ${error.message}`);

  const reconciled = invoice.reconciled && invoice.invoiceNo === invoiceNo;
  const message = reconciled
    ? `Invoice ${invoiceNo} for ${input.fdNumber} stored (${invoice.periodStart} to ${invoice.periodEnd}).`
    : `Invoice ${invoiceNo} for ${input.fdNumber} stored but needs checking: ${problems.join(" ")}`;
  return { status: "stored", invoiceNo, reconciled, message };
}
