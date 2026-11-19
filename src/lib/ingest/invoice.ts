/**
 * Reads a DPD self-billed invoice from its text (the portal's invoices are pictures, so the text comes
 * from character recognition and has the usual quirks: spaces missing, "S" read as "Ss").
 *
 * Every line amount and the "Total exc VAT" are excluding VAT; VAT is shown separately and the invoice
 * total is net plus VAT. The invoice is dated on the last day of the billing period.
 */

import { parseMoney, type Pence } from "@/lib/money";
import { parseUkDate, type ISODate } from "@/lib/dates";

export interface InvoiceLine {
  description: string;
  quantity: number | null;
  /** "Various" when DPD gives no single rate. */
  rate: string;
  /** Excluding VAT. */
  amount: Pence;
  vatCode: "S" | "Z" | "E" | null;
}

/**
 * What kind of DPD document it is:
 * - "period": the usual self-billed invoice for a four-week billing period.
 * - "support_payment": a one-off self-billed "Support Payment" (such as "Business start" when a franchise opens). It has no
 *   billing period, so it is dated on its invoice date.
 * - "vat_only": a "Self Billed VAT Only Invoice", which adds VAT to earlier invoices (listed by their document numbers) once
 *   the business is VAT registered. Its net is shown for reference only; it adds VAT, never more net income.
 */
export type InvoiceKind = "period" | "support_payment" | "vat_only";

/** An earlier invoice a VAT-only invoice adds VAT to. */
export interface VatReference {
  invoiceNo: string;
  docDate: ISODate | null;
  /** The earlier invoice's net, for reference. */
  net: Pence;
  vat: Pence;
}

export interface ParsedInvoice {
  kind: InvoiceKind;
  /** For a VAT-only invoice: the invoices it adds VAT to. Empty otherwise. */
  refersTo: VatReference[];
  invoiceNo: string;
  fdNumber: string;
  invoiceDate: ISODate;
  dueDate: ISODate | null;
  periodStart: ISODate;
  periodEnd: ISODate;
  lines: InvoiceLine[];
  netTotal: Pence;
  vatTotal: Pence;
  invoiceTotal: Pence;
  /** The lines add up to the net total, and net plus VAT is the invoice total. */
  reconciled: boolean;
  /** The printed totals agree with each other (net plus VAT is the invoice total), whatever happened to the lines. */
  totalsAgree: boolean;
  problems: string[];
}

/**
 * Whether the invoice number read from the picture is the number the portal lists. Character recognition mixes up look-alikes
 * ("S" for a 9 or a 5, "O" for 0, "I" or "l" for 1, "B" for 8, "Z" for 2), so a letter read where the portal has one of its
 * look-alike digits counts as the same number. Any other difference is a different number.
 */
const LOOK_ALIKES: Record<string, string> = { S: "59", O: "0", I: "1", L: "1", B: "8", Z: "2" };
export function invoiceNumbersMatch(portalNo: string, readNo: string): boolean {
  const a = portalNo.toUpperCase();
  const b = readNo.toUpperCase();
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (!(LOOK_ALIKES[b[i]!] ?? "").includes(a[i]!)) return false;
  }
  return true;
}

/**
 * The FD number printed on the invoice, as read: "FD75486". Spaces inside it are removed, and O, I and l in the digits are
 * read as 0 and 1 (an FD number is always FD and digits). S, B and Z are left as read: they could be more than one digit,
 * so fdNumbersMatch decides.
 */
export function readFdNumber(text: string): string | undefined {
  // Spaces (never line breaks) may split the digits; the number must end at a word boundary, so the next word is not read in.
  const m = /F[ \t]?D[ \t]*n[uo]mber[ \t]*\.?:?[ \t]*(F[ \t]?D)[ \t]?((?:[0-9OoIlSBZ][ \t]?){4,6})(?![0-9A-Za-z])/i.exec(text);
  if (!m) return undefined;
  const digits = m[2]!.replace(/\s/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  return `FD${digits}`;
}

/**
 * Whether the FD number read from an invoice is this franchise's. Exact after readFdNumber's clean-up, or the same number
 * with one look-alike slip ("S" read where the franchise has a 9). Sibling franchises differ in real digits (75486 and 75488),
 * which never match.
 */
export function fdNumbersMatch(franchiseFd: string, readFd: string): boolean {
  return invoiceNumbersMatch(franchiseFd.replace(/\s/g, ""), readFd.replace(/\s/g, ""));
}

/** Lines the daily Payments figures already contain (stop pay and excess parcels). Everything else is an extra payment. */
export const DAILY_PAYMENT_LINE = /successful|collection|delivery\s+stops|\bstops\b|excess\s*parcels|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i;

const MONEY = String.raw`-?£?\s?[\d,]+\.\d{2}`;

function money(text: string | undefined): Pence | null {
  return text ? parseMoney(text.replace(/\s/g, "")) : null;
}

export function parseSelfBilledInvoice(rawText: string): ParsedInvoice | null {
  const text = rawText.replace(/\r/g, "");
  const problems: string[] = [];
  // Recognition puts stray spaces and full stops in ("Invoice No.: SB 123456", "FD Number: FD 75486"); both are tolerated.
  const invoiceNo = /Invoice\s*n[o0]\.?:?\s*([A-Z]{1,3})\s?(\d{5,})/i.exec(text)?.slice(1, 3).join("").toUpperCase();
  const fdNumber = readFdNumber(text);
  const invoiceDate = parseUkDate(/Invoice\s*date:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1]);
  const dueText = /Due\s*date:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1];
  const dueDate = parseUkDate(dueText);
  // Dates are UK day-first. A printed date that is not a real day (such as 31/02/2026) is reported, never swapped round.
  if (dueText && !dueDate) problems.push(`The due date "${dueText}" is not a real date.`);
  const period = /period\s+(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  const periodStart = parseUkDate(period?.[1]);
  const periodEnd = parseUkDate(period?.[2]);
  if (!invoiceNo || !fdNumber || !invoiceDate) return null;
  // One-off documents have no billing period; they are read on their own terms.
  if (!period) {
    const header = { invoiceNo, fdNumber, invoiceDate, dueDate, problems };
    if (/V\s?AT\s+only\s+invoice|adjustment\s+of\s+V\s?AT/i.test(text)) return parseVatOnly(text, header);
    if (/support\s*payment/i.test(text)) return parseSupportPayment(text, header);
    return null;
  }
  if (!periodStart || !periodEnd) return null;
  if (periodEnd < periodStart) return null;

  // Lines sit between the table heading and the VAT analysis.
  const bodyStart = text.search(/Description\s+Quantity/i);
  const bodyEnd = text.search(/V\s?AT\s+analysis/i);
  const body = bodyStart >= 0 ? text.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : undefined) : "";
  const rows = body.split("\n").map((l) => l.trim()).filter(Boolean).slice(1);

  // A line is: description, quantity, rate, VAT code, amount. Character recognition slips (a quantity "1" read as "|", a "£"
  // read as "6") are tolerated here; the arithmetic check below decides whether the result can be trusted.
  const lineRe = /^(.*?)\s+(\S+)\s+(£?[\d.,]+|Various)\s+([SZE])s?\s+(\S*\d[\d,]*(?:\.\d{2})?)$/i;
  const draft: { description: string; quantity: number | null; rate: string; vatCode: "S" | "Z" | "E"; candidates: Pence[] }[] = [];
  for (const row of rows) {
    const match = lineRe.exec(row);
    if (match) {
      const token = match[5]!;
      const candidates: Pence[] = [];
      const plain = money(token.replace(/^£/, ""));
      if (plain != null) candidates.push(plain);
      // A decimal point lost in recognition ("£21726" for £217.26): the same digits with the point put back.
      const digits = token.replace(/^£/, "");
      if (/^\d{3,}$/.test(digits)) {
        const withPoint = money(`${digits.slice(0, -2)}.${digits.slice(-2)}`);
        if (withPoint != null) candidates.push(withPoint);
      }
      // "£" read as "6": the same amount without the leading 6 is the alternative.
      if (!token.startsWith("£") && token.startsWith("6")) {
        const alt = money(token.slice(1));
        if (alt != null) candidates.push(alt);
      }
      if (candidates.length === 0) { problems.push(`Could not read the amount on "${row}".`); continue; }
      const quantity = /^\d+$/.test(match[2]!) ? Number(match[2]) : /^[|Il]$/.test(match[2]!) ? 1 : null;
      draft.push({ description: match[1]!.trim(), quantity, rate: match[3]!, vatCode: match[4]!.toUpperCase() as "S" | "Z" | "E", candidates });
    } else if (draft.length > 0 && !/[£\d]\s*$/.test(row) && !/\d[\d,]*\.\d{2}/.test(row)) {
      // A wrapped description ("Monday - Friday:", "Saturday", "Sunday") belongs to the line above.
      draft[draft.length - 1]!.description += ` ${row.replace(/:$/, "")}`;
    }
  }

  const { netTotal, vatTotal, invoiceTotal } = printedTotals(text);
  if (netTotal == null || vatTotal == null || invoiceTotal == null) return null;

  // Pick, for every line with more than one possible reading, the combination that adds up to the invoice's own net total.
  const chosen = draft.map((d) => d.candidates[0]!);
  const ambiguous = draft.map((d, i) => (d.candidates.length > 1 ? i : -1)).filter((i) => i >= 0);
  const sumOf = (picks: Pence[]) => picks.reduce((n, v) => n + v, 0);
  if (sumOf(chosen) !== netTotal && ambiguous.length > 0 && ambiguous.length <= 6) {
    const trial = [...chosen];
    const search = (k: number): boolean => {
      if (k === ambiguous.length) return sumOf(trial) === netTotal;
      const lineIndex = ambiguous[k]!;
      for (const candidate of draft[lineIndex]!.candidates) {
        trial[lineIndex] = candidate;
        if (search(k + 1)) return true;
      }
      return false;
    };
    if (search(0)) chosen.splice(0, chosen.length, ...trial);
  }
  const lines: InvoiceLine[] = draft.map((d, i) => ({ description: d.description, quantity: d.quantity, rate: d.rate, amount: chosen[i]!, vatCode: d.vatCode }));
  const linesSum = sumOf(chosen);
  // Only the figures printed on the invoice are used. A VAT figure that does not match the printed totals is reported as it
  // stands, never replaced with a figure the invoice does not show.
  const totalsAgree = netTotal + vatTotal === invoiceTotal;
  const reconciled = lines.length > 0 && linesSum === netTotal && totalsAgree;
  if (lines.length === 0) problems.push("No invoice lines could be read.");
  else if (linesSum !== netTotal) problems.push(`The lines add up to ${linesSum / 100} but the invoice states ${netTotal / 100} excluding VAT.`);
  if (!totalsAgree) problems.push("Net plus VAT is not the invoice total.");

  return { kind: "period", refersTo: [], invoiceNo, fdNumber, invoiceDate, dueDate, periodStart, periodEnd, lines, netTotal, vatTotal, invoiceTotal, reconciled, totalsAgree, problems };
}

/** The printed "Total exc VAT", "VAT" and "Invoice total", each null when not printed. */
function printedTotals(text: string): { netTotal: Pence | null; vatTotal: Pence | null; invoiceTotal: Pence | null } {
  const netTotal = money(new RegExp(String.raw`Total\s*ex(?:cl(?:uding)?|c)?\.?\s*VAT\s*(${MONEY})`, "i").exec(text)?.[1]);
  // A line such as "Total excl VAT £7,303.36" ends with "VAT £7,303.36" but that figure is the net total, not the VAT.
  let vatTotal: Pence | null = null;
  const vatRe = new RegExp(String.raw`(?:^|\s)VAT\s*(${MONEY})\s*$`, "gim");
  for (const match of text.matchAll(vatRe)) {
    const line = text.slice(text.lastIndexOf("\n", match.index) + 1, (match.index ?? 0) + match[0].length);
    if (/total\s*ex(?:cl(?:uding)?|c)?\.?\s*VAT/i.test(line)) continue;
    vatTotal = money(match[1]);
    if (vatTotal != null) break;
  }
  const invoiceTotal = money(new RegExp(String.raw`Invoice\s*total\s*(${MONEY})`, "i").exec(text)?.[1]);
  return { netTotal, vatTotal, invoiceTotal };
}

type Header = { invoiceNo: string; fdNumber: string; invoiceDate: ISODate; dueDate: ISODate | null; problems: string[] };

/**
 * A one-off "Support Payment" self-billed invoice, such as "Business start 1 £500.00 £500.00". There is no billing period,
 * so it is dated on its invoice date. When it prints no VAT (the business was not VAT registered: "VAT reg: n/a"), its VAT
 * is nil and the invoice total is its net.
 */
function parseSupportPayment(text: string, h: Header): ParsedInvoice | null {
  const problems = [...h.problems];
  const bodyStart = text.search(/Description\s+Quantity/i);
  const bodyEnd = text.search(/V\s?AT\s+analysis|Invoice\s*total|Total\s*ex/i);
  const body = bodyStart >= 0 ? text.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : undefined) : "";
  const rows = body.split("\n").map((l) => l.trim()).filter(Boolean).slice(1);
  // Description, quantity, rate, an optional VAT code, amount.
  const lineRe = /^(.*?[A-Za-z].*?)\s+(\d+|[|Il])\s+(£?[\d,]+\.\d{2}|Various)\s+(?:([SZEO0])s?\s+)?(-?£?[\d,]+\.\d{2})$/;
  const lines: InvoiceLine[] = [];
  for (const row of rows) {
    const m = lineRe.exec(row);
    if (!m) continue;
    const amount = money(m[5]!.replace(/^£/, ""));
    if (amount == null) { problems.push(`Could not read the amount on "${row}".`); continue; }
    const code = (m[4] ?? "").toUpperCase();
    lines.push({
      description: m[1]!.trim(), quantity: /^\d+$/.test(m[2]!) ? Number(m[2]) : 1, rate: m[3]!, amount,
      vatCode: code === "S" || code === "Z" || code === "E" ? code : null,
    });
  }
  const printed = printedTotals(text);
  if (printed.invoiceTotal == null) return null;
  const linesSum = lines.reduce((n, l) => n + l.amount, 0);
  // No VAT printed: nil VAT (only figures the invoice shows are used; nothing is worked out at 20%).
  const vatTotal = printed.vatTotal ?? 0;
  const netTotal = printed.netTotal ?? printed.invoiceTotal - vatTotal;
  const totalsAgree = netTotal + vatTotal === printed.invoiceTotal;
  const reconciled = lines.length > 0 && linesSum === netTotal && totalsAgree;
  if (lines.length === 0) problems.push("No invoice lines could be read.");
  else if (linesSum !== netTotal) problems.push(`The lines add up to ${linesSum / 100} but the invoice states ${netTotal / 100} excluding VAT.`);
  if (!totalsAgree) problems.push("Net plus VAT is not the invoice total.");
  return {
    kind: "support_payment", refersTo: [], invoiceNo: h.invoiceNo, fdNumber: h.fdNumber, invoiceDate: h.invoiceDate, dueDate: h.dueDate,
    periodStart: h.invoiceDate, periodEnd: h.invoiceDate, lines, netTotal, vatTotal, invoiceTotal: printed.invoiceTotal, reconciled, totalsAgree, problems,
  };
}

/**
 * A "Self Billed VAT Only Invoice": VAT added to earlier invoices, one row each ("FI1020123 14/09/2026 GB... S 20% £500.00
 * £100.00"). The rows' net is the earlier invoice's, for reference; the invoice's own net total is nil. Dated on its
 * invoice date.
 */
function parseVatOnly(text: string, h: Header): ParsedInvoice | null {
  const problems = [...h.problems];
  const refersTo: VatReference[] = [];
  const rowRe = /^\s*(F[A-Z]{0,2}\d{5,})\s+(\d{2}\/\d{2}\/\d{4})\b.*?(-?£?[\d,]+\.\d{2})\s+(-?£?[\d,]+\.\d{2})\s*$/gim;
  for (const m of text.matchAll(rowRe)) {
    if (m[1]!.toUpperCase() === h.invoiceNo) continue;
    const net = money(m[3]!.replace(/£/, ""));
    const vat = money(m[4]!.replace(/£/, ""));
    if (net == null || vat == null) { problems.push(`Could not read the amounts for ${m[1]}.`); continue; }
    refersTo.push({ invoiceNo: m[1]!.toUpperCase(), docDate: parseUkDate(m[2]) ?? null, net, vat });
  }
  const { netTotal, vatTotal, invoiceTotal } = printedTotals(text);
  if (netTotal == null || vatTotal == null || invoiceTotal == null) return null;
  const refsVat = refersTo.reduce((n, r) => n + r.vat, 0);
  const totalsAgree = netTotal + vatTotal === invoiceTotal;
  const reconciled = refersTo.length > 0 && refsVat === vatTotal && netTotal === 0 && totalsAgree;
  if (refersTo.length === 0) problems.push("No earlier invoices could be read from the VAT table.");
  else if (refsVat !== vatTotal) problems.push(`The VAT rows add up to ${refsVat / 100} but the invoice states VAT of ${vatTotal / 100}.`);
  if (netTotal !== 0) problems.push("A VAT-only invoice should have no net amount.");
  if (!totalsAgree) problems.push("Net plus VAT is not the invoice total.");
  return {
    kind: "vat_only", refersTo, invoiceNo: h.invoiceNo, fdNumber: h.fdNumber, invoiceDate: h.invoiceDate, dueDate: h.dueDate,
    periodStart: h.invoiceDate, periodEnd: h.invoiceDate, lines: [], netTotal, vatTotal, invoiceTotal, reconciled, totalsAgree, problems,
  };
}
