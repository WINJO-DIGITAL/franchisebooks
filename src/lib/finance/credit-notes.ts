/**
 * Credit notes. DPD can credit a franchise, either as money back or against a charge. Either way the franchise is better
 * off by that amount, so it is recorded as money in, clearly labelled, rather than as a negative expense (expenses never
 * go below zero). It counts in income exactly like a payment. Pure code.
 */

export type RevenueKind = "payment" | "credit_note";

export const CREDIT_NOTE_LABEL = "Credit note";

/** The description stored with a revenue entry. A credit note always says so, with any note after it. */
export function revenueDescription(kind: RevenueKind, note: string | null): string | null {
  const text = note?.trim() || null;
  if (kind === "credit_note") return text ? `${CREDIT_NOTE_LABEL}: ${text}` : CREDIT_NOTE_LABEL;
  return text;
}

export function isCreditNote(description: string | null | undefined): boolean {
  return description != null && description.startsWith(CREDIT_NOTE_LABEL);
}
