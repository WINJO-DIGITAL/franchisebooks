/**
 * Stores one DPD self-billed invoice (a PDF from the portal's Invoices page) in dpd_invoices.
 *
 * The invoice's own arithmetic decides whether it is trusted: "reconciled" means its lines add up to its net total.
 * The invoice as a whole is a cross-check (docs/CORE.md rules 2 and 3). Only its extra lines that are not in the daily
 * payments (Fuel Supplement, C&D App, and similar) count as income, and only when the invoice is reconciled. An unreadable or unreconciled invoice is still stored with its problems, so it can be checked
 * rather than silently dropped.
 */

import { readSelfBilledInvoicePdf } from "./invoice-pdf";
import { fdNumbersMatch, invoiceNumbersMatch, type ParsedInvoice } from "./invoice";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";

export type InvoiceStatus = "stored" | "unreadable" | "wrong_franchise" | "incomplete";

export interface InvoiceImportOutcome {
  status: InvoiceStatus;
  invoiceNo: string | null;
  /** The lines add up and the totals agree: the invoice can be used in full. */
  reconciled: boolean;
  /** The printed totals agree with each other, even if the lines could not be read exactly. Nothing to check by hand. */
  totalsAgree: boolean;
  message: string;
  /** The FD number read from the invoice, when it could be read. */
  fdRead?: string | null;
  /** The franchise it was stored for, when that is not the one it was listed under. */
  storedForFranchiseId?: string | null;
  /** Where the recognised text was kept (private diagnostics storage) when the invoice could not be used as it stands. */
  diagnosticsPath?: string | null;
}

/** Decides what a parsed invoice means for the franchise it was downloaded for. Pure, so it is testable without the portal. */
export function classifyInvoice(invoice: ParsedInvoice | null, franchiseFd: string): InvoiceStatus {
  if (!invoice) return "unreadable";
  if (!invoice.periodStart || !invoice.periodEnd || !invoice.invoiceDate) return "incomplete";
  if (!fdNumbersMatch(franchiseFd, invoice.fdNumber)) return "wrong_franchise";
  return "stored";
}

/**
 * Stores an invoice keyed by the number the portal lists for it (the link's row), not by the number read from the PDF:
 * the portal's list is what the next night's run checks against, so the two must agree.
 */
export async function importSelfBilledInvoice(
  db: AdminClient,
  input: {
    accountId: string; franchiseId: string; fdNumber: string; portalInvoiceNo: string; bytes: Uint8Array;
    /** Every franchise in the business. An invoice listed under one franchise but printed for another of them is stored for that one. */
    accountFranchises?: { id: string; fdNumber: string }[];
  },
): Promise<InvoiceImportOutcome> {
  const { invoice, text } = await readSelfBilledInvoicePdf(input.bytes);
  let franchiseId = input.franchiseId;
  let fdNumber = input.fdNumber;
  let status = classifyInvoice(invoice, input.fdNumber);
  // The portal can list a sibling franchise's invoices (one login sees both). Such an invoice belongs to that franchise.
  if (status === "wrong_franchise" && invoice) {
    const owner = (input.accountFranchises ?? []).find((f) => f.id !== input.franchiseId && fdNumbersMatch(f.fdNumber, invoice.fdNumber));
    if (owner) {
      franchiseId = owner.id;
      fdNumber = owner.fdNumber;
      status = "stored";
    }
  }
  const invoiceNo = input.portalInvoiceNo;
  const problems = [...(invoice?.problems ?? [])];
  if (invoice && !invoiceNumbersMatch(invoiceNo, invoice.invoiceNo)) problems.push(`The portal lists this invoice as ${invoiceNo}, but the PDF reads as ${invoice.invoiceNo}. Check the number.`);
  const elsewhere = franchiseId !== input.franchiseId ? ` (listed under ${input.fdNumber})` : "";

  if (!invoice || status !== "stored") {
    const diagnosticsPath = await keepRecognisedText(db, input.accountId, invoiceNo, text);
    const creditNote = !invoice && /credit\s*note/i.test(text);
    const message = status === "wrong_franchise"
      ? `Invoice ${invoiceNo} reads as being for ${invoice?.fdNumber}, which is not ${input.fdNumber} or another franchise in this business, so it was not stored. Check the FD number on the invoice.`
      : creditNote
        ? `Document ${invoiceNo} for ${input.fdNumber} is a credit note, which is not read automatically yet, so it was not stored. Check it in the DPD portal.`
        : status === "incomplete"
          ? `Invoice ${invoiceNo} for ${input.fdNumber} is missing its dates, so it was not stored. It will be tried again tomorrow.`
          : `Invoice ${invoiceNo} for ${input.fdNumber} could not be read (${describeUnreadable(text)}), so it was not stored. It will be tried again tomorrow.`;
    return { status, invoiceNo, reconciled: false, totalsAgree: false, message, fdRead: invoice?.fdNumber ?? null, diagnosticsPath };
  }

  const { error } = await db.from("dpd_invoices").upsert(
    {
      account_id: input.accountId,
      franchise_id: franchiseId,
      invoice_no: invoiceNo,
      invoice_date: invoice.invoiceDate,
      due_date: invoice.dueDate,
      period_start: invoice.periodStart,
      period_end: invoice.periodEnd,
      net_total: invoice.netTotal / 100,
      vat_total: invoice.vatTotal / 100,
      invoice_total: invoice.invoiceTotal / 100,
      lines: invoice.lines as unknown as JsonObject[],
      reconciled: invoice.reconciled && invoiceNumbersMatch(invoiceNo, invoice.invoiceNo),
      problems: problems as unknown as JsonObject[],
    },
    { onConflict: "account_id,invoice_no", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Could not store invoice ${invoiceNo}: ${error.message}`);

  const numberOk = invoiceNumbersMatch(invoiceNo, invoice.invoiceNo);
  const reconciled = invoice.reconciled && numberOk;
  const totalsAgree = invoice.totalsAgree && numberOk;
  const diagnosticsPath = totalsAgree ? null : await keepRecognisedText(db, input.accountId, invoiceNo, text);
  const message = reconciled
    ? `Invoice ${invoiceNo} for ${fdNumber}${elsewhere} stored (${invoice.periodStart} to ${invoice.periodEnd}).`
    : totalsAgree
      // The printed totals agree, so the invoice is stored as it stands; only its line detail could not be read exactly.
      ? `Invoice ${invoiceNo} for ${fdNumber}${elsewhere} stored with its totals (${invoice.periodStart} to ${invoice.periodEnd}); the lines could not be read exactly, so its extras are not counted.`
      : `Invoice ${invoiceNo} for ${fdNumber}${elsewhere} stored but needs checking: ${problems.join(" ")}`;
  return { status: "stored", invoiceNo, reconciled, totalsAgree, message, fdRead: invoice.fdNumber, storedForFranchiseId: franchiseId, diagnosticsPath };
}

/** What was missing from an unreadable invoice's text, in plain words, so the log says why. */
export function describeUnreadable(text: string): string {
  if (text.trim().length < 40) return "no text could be recognised on it";
  const missing = [
    /Invoice\s*n[o0]/i.test(text) ? null : "invoice number",
    /F\s?D\s*n[uo]mber/i.test(text) ? null : "FD number",
    /Invoice\s*date/i.test(text) ? null : "invoice date",
    /period\s+\d{2}\/\d{2}\/\d{4}\s+to/i.test(text) ? null : "billing period",
    /Invoice\s*total/i.test(text) ? null : "invoice total",
  ].filter((m): m is string => m !== null);
  return missing.length ? `no ${missing.join(", ")} found` : "its figures could not be read";
}

/** Keeps the recognised text of an invoice that needs checking in private storage, so a person can see what was read. */
async function keepRecognisedText(db: AdminClient, accountId: string, invoiceNo: string, text: string): Promise<string | null> {
  if (!text) return null;
  const path = `${accountId}/invoices/${invoiceNo.replace(/[^A-Za-z0-9_-]/g, "_")}.txt`;
  const upload = await db.storage.from("diagnostics").upload(path, new TextEncoder().encode(text), { contentType: "text/plain; charset=utf-8", upsert: true });
  return upload.error ? null : path;
}
