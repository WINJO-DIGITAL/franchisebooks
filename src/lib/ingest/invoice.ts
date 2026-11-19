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

export interface ParsedInvoice {
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

/** Lines the daily Payments figures already contain (stop pay and excess parcels). Everything else is an extra payment. */
export const DAILY_PAYMENT_LINE = /successful|collection|delivery\s+stops|\bstops\b|excess\s*parcels|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i;

const MONEY = String.raw`-?£?\s?[\d,]+\.\d{2}`;

function money(text: string | undefined): Pence | null {
  return text ? parseMoney(text.replace(/\s/g, "")) : null;
}

export function parseSelfBilledInvoice(rawText: string): ParsedInvoice | null {
  const text = rawText.replace(/\r/g, "");
  const problems: string[] = [];
  const invoiceNo = /Invoice\s*no:?\s*([A-Z]{1,3}\d{5,})/i.exec(text)?.[1];
  const fdNumber = /FD\s*number:?\s*(FD\d{4,6})/i.exec(text)?.[1];
  const invoiceDate = parseUkDate(/Invoice\s*date:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1]);
  const dueDate = parseUkDate(/Due\s*date:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1]);
  const period = /period\s+(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  const periodStart = parseUkDate(period?.[1]);
  const periodEnd = parseUkDate(period?.[2]);
  if (!invoiceNo || !fdNumber || !invoiceDate || !periodStart || !periodEnd) return null;

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

  const netTotal = money(new RegExp(String.raw`Total\s*exc\s*VAT\s*(${MONEY})`, "i").exec(text)?.[1]);
  const vatTotal = money(new RegExp(String.raw`(?:^|\s)VAT\s*(${MONEY})\s*$`, "im").exec(text)?.[1]);
  const invoiceTotal = money(new RegExp(String.raw`Invoice\s*total\s*(${MONEY})`, "i").exec(text)?.[1]);
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

  return { invoiceNo, fdNumber, invoiceDate, dueDate, periodStart, periodEnd, lines, netTotal, vatTotal, invoiceTotal, reconciled, totalsAgree, problems };
}
