/**
 * Totals for the Expenses page. Pure code.
 *
 * VAT is only ever what a document states; no rate is assumed. So costs fall into three groups:
 *   • before VAT: the amount is known to be before VAT (DPD charges, and anything whose VAT was stated);
 *   • VAT-inclusive: the file says the amount includes VAT, but not how much;
 *   • VAT not stated: nothing says either way. These are shown on their own line, never added to "before VAT".
 */

import type { Pence } from "@/lib/money";

/** Categories that are costs of the business as a whole, so they count as a business cost, not as waiting to be assigned. */
export const BUSINESS_COST_CATEGORIES = ["Insurance", "Franchise fee", "Vehicle maintenance"] as const;

export function isBusinessCostCategory(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  return BUSINESS_COST_CATEGORIES.some((c) => c.toLowerCase() === n);
}

export interface SummaryCost {
  kind: "fuel" | "expense";
  categoryName: string;
  amount: Pence;
  vat: Pence | null;
  vatBasis: "net" | "gross" | "not_stated";
}

export interface CostSummary {
  beforeVat: Pence;
  vat: Pence;
  /** Before VAT plus VAT, plus the VAT-inclusive amounts. */
  withVat: Pence;
  vatInclusive: Pence;
  vatInclusiveCount: number;
  vatNotStated: Pence;
  vatNotStatedCount: number;
  /** Everything paid: all amounts plus stated VAT. */
  totalSpent: Pence;
  byCategory: { name: string; count: number; amount: Pence; vat: Pence; businessCost: boolean }[];
}

export function summariseCosts(costs: SummaryCost[]): CostSummary {
  let beforeVat = 0, vat = 0, vatInclusive = 0, vatInclusiveCount = 0, vatNotStated = 0, vatNotStatedCount = 0;
  const categories = new Map<string, { name: string; count: number; amount: number; vat: number }>();
  for (const c of costs) {
    if (c.vatBasis === "net") {
      beforeVat += c.amount;
      vat += c.vat ?? 0;
    } else if (c.vatBasis === "gross") {
      vatInclusive += c.amount;
      vatInclusiveCount += 1;
    } else {
      vatNotStated += c.amount;
      vatNotStatedCount += 1;
    }
    const name = c.kind === "fuel" ? "Fuel" : c.categoryName;
    const entry = categories.get(name) ?? { name, count: 0, amount: 0, vat: 0 };
    entry.count += 1;
    entry.amount += c.amount;
    entry.vat += c.vatBasis === "net" ? (c.vat ?? 0) : 0;
    categories.set(name, entry);
  }
  return {
    beforeVat,
    vat,
    withVat: beforeVat + vat + vatInclusive,
    vatInclusive,
    vatInclusiveCount,
    vatNotStated,
    vatNotStatedCount,
    totalSpent: beforeVat + vat + vatInclusive + vatNotStated,
    byCategory: [...categories.values()]
      .map((c) => ({ ...c, businessCost: isBusinessCostCategory(c.name) }))
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "en-GB")),
  };
}
