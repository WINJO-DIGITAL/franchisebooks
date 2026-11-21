import { loadPeriodData, type PeriodFilter } from "@/lib/data/period";
import { addMonths, monthRange, type ISODate, type YearMonth } from "@/lib/dates";
import { summariseCosts } from "@/lib/finance/cost-summary";
import { sumPence, type Pence } from "@/lib/money";

/**
 * The VAT figures for a calendar quarter, as the documents state them. Nothing is assumed: VAT is only counted where a document
 * states it, and anything without a stated figure is listed as such. Output VAT on DPD's daily payments is not stated in the
 * daily payment reports, so it is not shown here.
 */

export interface VatQuarter { start: YearMonth; from: ISODate; to: ISODate; label: string }

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The calendar quarter that starts on a given month (January, April, July or October). */
export function quarterFrom(start: YearMonth): VatQuarter {
  const end = addMonths(start, 2);
  const [, sm] = start.split("-").map(Number) as [number, number];
  const [ey, em] = end.split("-").map(Number) as [number, number];
  return { start, from: monthRange(start).start, to: monthRange(end).end, label: `${MONTH_SHORT[sm - 1]} to ${MONTH_SHORT[em - 1]} ${ey}` };
}

/** The quarter containing today's date. */
export function currentQuarterStart(today: ISODate): YearMonth {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, "0")}`;
}

/** The last four completed quarters, most recent first. */
export function recentQuarters(today: ISODate, count = 4): VatQuarter[] {
  const current = currentQuarterStart(today);
  return Array.from({ length: count }, (_, i) => quarterFrom(addMonths(current, -3 * (i + 1))));
}

export interface VatSummary {
  quarter: VatQuarter;
  /** VAT stated on fuel and other costs (the input VAT). */
  inputVat: Pence;
  inputVatItems: number;
  /** Costs whose document says the amount includes VAT, with no VAT figure. */
  includedAmount: Pence;
  includedItems: number;
  /** Costs whose document does not say whether VAT is included. */
  notStatedAmount: Pence;
  notStatedItems: number;
  /** VAT stated on DPD's extra invoice lines (C&D App, Fuel Supplement and similar). */
  dpdExtrasVat: Pence;
  dpdExtrasItems: number;
}

export async function loadVatSummary(db: Parameters<typeof loadPeriodData>[0], filter: { accountId: string; quarter: VatQuarter; franchiseId?: string | null; hiddenFranchiseIds?: string[] }): Promise<VatSummary> {
  const period: PeriodFilter = { accountId: filter.accountId, from: filter.quarter.from, to: filter.quarter.to, franchiseId: filter.franchiseId ?? null, hiddenFranchiseIds: filter.hiddenFranchiseIds };
  const data = await loadPeriodData(db, period);
  const costs = summariseCosts(data.costs);
  const extras = data.otherPayments.filter((o) => (o.vat ?? 0) !== 0);
  return {
    quarter: filter.quarter,
    inputVat: costs.vat,
    inputVatItems: data.costs.filter((c) => c.vat != null && c.vat !== 0).length,
    includedAmount: costs.vatInclusive,
    includedItems: costs.vatInclusiveCount,
    notStatedAmount: costs.vatNotStated,
    notStatedItems: costs.vatNotStatedCount,
    dpdExtrasVat: sumPence(extras.map((o) => o.vat ?? 0)),
    dpdExtrasItems: extras.length,
  };
}
