/**
 * The cross-check for a closed pay period: do our figures agree with what DPD invoices?
 *
 * Money in: the daily Payments we imported, against the stop-pay lines on DPD's self-billed invoice.
 * Money out: the charges we imported (excluding VAT, as the portal states them), with VAT added at 20% as an
 * ESTIMATE (DPD rounds a penny differently on some lines), to compare with the DPD invoice.
 * Due: the self-billed invoice total less the charges, which is what should arrive on the Friday.
 *
 * Pure code: no database, no network.
 */

import { addDays, type ISODate } from "@/lib/dates";
import { DAILY_PAYMENT_LINE } from "@/lib/ingest/invoice";
import type { Pence } from "@/lib/money";
import { sumPence } from "@/lib/money";
import { invoiceDueDate, type DpdPeriod } from "./periods";

export const VAT_RATE_PERCENT = 20;

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
  charges: { count: number; net: Pence; vatEstimate: Pence; grossEstimate: Pence };
  payable: {
    dueDate: ISODate;
    selfBilledGross: Pence | null;
    chargesGrossEstimate: Pence;
    /** Self-billed gross less charges. Null until the self-billed invoice is in. Estimate: charge VAT is estimated. */
    expected: Pence | null;
  };
}

/** VAT on one charge at the standard rate, rounded to the penny. */
export function vatOn(net: Pence): Pence {
  return Math.round((net * VAT_RATE_PERCENT) / 100);
}

export function checkPeriod(input: PeriodCheckInput): PeriodCheck {
  const ourPayments = sumPence(input.payments);
  const net = sumPence(input.charges);
  const vatEstimate = sumPence(input.charges.map(vatOn));
  const grossEstimate = net + vatEstimate;

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

  const selfBilledGross = invoice && invoice.reconciled ? invoice.invoiceTotal : null;
  return {
    income: { status, ourPayments, invoiceStopPay, difference, extras },
    charges: { count: input.charges.length, net, vatEstimate, grossEstimate },
    payable: {
      dueDate: invoice?.dueDate ?? invoiceDueDate(input.period),
      selfBilledGross,
      chargesGrossEstimate: grossEstimate,
      expected: selfBilledGross == null ? null : selfBilledGross - grossEstimate,
    },
  };
}
