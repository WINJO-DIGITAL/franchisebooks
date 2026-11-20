/**
 * Whether a franchise is charging VAT, read from the VAT stated on its DPD invoice each period.
 *
 * DPD's invoice states VAT when the franchisee is VAT registered and states none when they are not. So the app does not
 * ask the owner: it reads each period's invoice and says what that invoice shows. It never calculates VAT.
 *
 * A franchise can change status over time, so the answer is given per period, and a change between two periods is named
 * as the change it looks like: the first period with VAT after periods without it is "became registered"; the reverse is
 * "stopped charging VAT". Nothing is decided by the app for the owner; the change is shown as read.
 */

import type { Pence } from "@/lib/money";

export type VatPeriodStatus =
  /** The invoice states VAT. */
  | "charging"
  /** The invoice is read and states no VAT. */
  | "not_charging"
  /** There is no invoice for the period yet, so nothing is known. */
  | "unknown";

export interface VatPeriodInput {
  periodStart: string;
  /** The invoice's stated VAT, or null when there is no invoice for the period. */
  vatTotal: Pence | null;
}

export type VatChange = "became_registered" | "stopped_charging";

export interface VatPeriodResult {
  periodStart: string;
  status: VatPeriodStatus;
  /** Set when this period's status differs from the most recent known period before it. */
  change: VatChange | null;
}

/**
 * Sorts the periods oldest first and gives each one's status and any change from the last known status before it.
 * Periods with no invoice are "unknown" and are skipped when looking for a change, so a missing invoice never creates a change.
 */
export function vatStatusByPeriod(periods: VatPeriodInput[]): VatPeriodResult[] {
  const ordered = periods.slice().sort((a, b) => (a.periodStart < b.periodStart ? -1 : a.periodStart > b.periodStart ? 1 : 0));
  let lastKnown: VatPeriodStatus | null = null;
  return ordered.map((p) => {
    const status: VatPeriodStatus = p.vatTotal == null ? "unknown" : p.vatTotal > 0 ? "charging" : "not_charging";
    let change: VatChange | null = null;
    if (status !== "unknown") {
      if (lastKnown === "not_charging" && status === "charging") change = "became_registered";
      if (lastKnown === "charging" && status === "not_charging") change = "stopped_charging";
      lastKnown = status;
    }
    return { periodStart: p.periodStart, status, change };
  });
}

export const VAT_STATUS_TEXT: Record<VatPeriodStatus, string> = {
  charging: "VAT on invoice",
  not_charging: "No VAT on invoice",
  unknown: "No invoice yet",
};

export const VAT_CHANGE_TEXT: Record<VatChange, string> = {
  became_registered: "VAT first appears on this invoice. The franchise looks newly VAT registered.",
  stopped_charging: "VAT stops appearing on this invoice. The franchise looks to have stopped charging VAT.",
};
