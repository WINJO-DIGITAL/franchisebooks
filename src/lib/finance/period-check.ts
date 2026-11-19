/**
 * The cross-check for a closed pay period: do our figures agree with what DPD invoices?
 *
 * Money in: the daily Payments we imported, against the stop-pay lines on DPD's self-billed invoice.
 * Money out: the charges we imported, excluding VAT, exactly as the portal states them.
 * The invoice's own printed figures (totals, VAT, due date) are shown as printed. Nothing is estimated or worked out.
 *
 * Pure code: no database, no network.
 */

import { addDays, type ISODate } from "@/lib/dates";
import { DAILY_PAYMENT_LINE } from "@/lib/ingest/invoice";
import type { Pence } from "@/lib/money";
import { sumPence } from "@/lib/money";
import type { DpdPeriod } from "./periods";

export interface CheckInvoiceLine {
  description: string;
  /** Pence, excluding VAT. */
  amount: Pence;
}

export interface CheckInvoice {
  invoiceNo: string;
  dueDate: ISODate | null;
  netTotal: Pence;
  vatTotal: Pence;
  invoiceTotal: Pence;
  /** False when the lines could not be read reliably. */
  reconciled: boolean;
  lines: CheckInvoiceLine[];
}

export interface PeriodCheckInput {
  period: DpdPeriod;
  /** The franchise's daily payments in the period (DPD totals, pence). */
  payments: Pence[];
  /** The franchise's DPD charges in the period, excluding VAT. */
  charges: Pence[];
  invoice: CheckInvoice | null;
  tolerancePence: Pence;
  /**
   * The first and last day of daily payments the app holds for this franchise. The invoice is compared only for a period these
   * cover: before the first day there is no data, which is not the same as nothing having been paid. Leave out to always compare.
   */
  coverage?: { first: ISODate | null; last: ISODate | null };
}

/** "unread": the app does not hold the daily payments for this period (it started reading later), so there is nothing to compare. */
export type IncomeStatus = "waiting" | "unreadable" | "unread" | "match" | "differs";

export interface PeriodCheck {
  income: {
    status: IncomeStatus;
    ourPayments: Pence;
    /** The invoice lines the daily Payments already contain. Null until a readable invoice exists. */
    invoiceStopPay: Pence | null;
    /** Our payments minus the invoice. Null until a readable invoice exists. */
    difference: Pence | null;
    /** Invoice lines that are not daily payments (Fuel Supplement, C&D App ...). */
    extras: CheckInvoiceLine[];
  };
  /** The charges the portal lists for the period, excluding VAT as the portal states them. Nothing is added or estimated. */
  charges: { count: number; net: Pence };
  /** The invoice's own printed figures, shown as printed. Null until the invoice is in. No due date or total is worked out. */
  invoiceStated: { dueDate: ISODate | null; netTotal: Pence; vatTotal: Pence; invoiceTotal: Pence } | null;
}

export function checkPeriod(input: PeriodCheckInput): PeriodCheck {
  const ourPayments = sumPence(input.payments);
  const net = sumPence(input.charges);

  const invoice = input.invoice;
  let status: IncomeStatus = "waiting";
  let invoiceStopPay: Pence | null = null;
  let difference: Pence | null = null;
  let extras: CheckInvoiceLine[] = [];

  if (invoice) {
    if (!invoice.reconciled) {
      status = "unreadable";
    } else {
      invoiceStopPay = sumPence(invoice.lines.filter((l) => DAILY_PAYMENT_LINE.test(l.description)).map((l) => l.amount));
      extras = invoice.lines.filter((l) => !DAILY_PAYMENT_LINE.test(l.description));
      const cov = input.coverage;
      const covered = cov === undefined || (cov.first != null && cov.last != null && cov.first <= addDays(input.period.start, 6) && cov.last >= addDays(input.period.end, -6));
      if (!covered) {
        status = "unread";
      } else {
        difference = ourPayments - invoiceStopPay;
        status = Math.abs(difference) <= input.tolerancePence ? "match" : "differs";
      }
    }
  }

  return {
    income: { status, ourPayments, invoiceStopPay, difference, extras },
    charges: { count: input.charges.length, net },
    invoiceStated: invoice ? { dueDate: invoice.dueDate, netTotal: invoice.netTotal, vatTotal: invoice.vatTotal, invoiceTotal: invoice.invoiceTotal } : null,
  };
}
