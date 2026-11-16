/**
 * Matching imported rows to franchises, drivers and vehicles.
 *
 * Matching is deliberately conservative: a row is only attributed when there
 * is exactly one candidate. Anything ambiguous is left unmatched for the
 * owner to decide — an expense is never pinned on a driver by guesswork.
 */

import type { ISODate } from "@/lib/dates";

export interface RosterDriver {
  id: string;
  displayName: string;
  dpdRef: string | null;
  aliases: string[];
  assignments: { franchiseId: string; startDate: ISODate; endDate: ISODate | null; vehicleRegistration: string | null }[];
}

export interface RosterFranchise {
  id: string;
  fdNumber: string;
}

/** Lower-case, punctuation-free, single-spaced form of a person's name. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Order-independent key so "SMITH, John" and "John Smith" compare equal. */
function nameTokensKey(name: string): string {
  return normaliseName(name).replace(/,/g, " ").split(" ").filter(Boolean).sort().join(" ");
}

/** The stable key stored on an imported row to identify "the same driver as named by the source". */
export function driverKeyFor(ref: string | null, name: string): string {
  const cleanedRef = ref?.trim();
  return cleanedRef ? `ref:${cleanedRef.toLowerCase()}` : `name:${nameTokensKey(name)}`;
}

function assignedOn(driver: RosterDriver, franchiseId: string | null, date: ISODate): boolean {
  return driver.assignments.some(
    (a) => (franchiseId == null || a.franchiseId === franchiseId) && a.startDate <= date && (a.endDate == null || a.endDate >= date),
  );
}

export interface DriverMatch {
  driverId: string | null;
  method: "dpd_ref" | "name" | null;
  /** True when more than one driver fits and the row was therefore left unmatched. */
  ambiguous: boolean;
}

export function matchDriver(
  source: { ref: string | null; name: string | null; franchiseId: string | null; date: ISODate },
  roster: RosterDriver[],
): DriverMatch {
  const ref = source.ref?.trim().toLowerCase();
  if (ref) {
    const byRef = roster.filter((d) => d.dpdRef?.trim().toLowerCase() === ref);
    if (byRef.length === 1) return { driverId: byRef[0]!.id, method: "dpd_ref", ambiguous: false };
    if (byRef.length > 1) return { driverId: null, method: null, ambiguous: true };
  }
  if (!source.name || source.name.trim() === "") return { driverId: null, method: null, ambiguous: false };

  const key = nameTokensKey(source.name);
  if (key === "") return { driverId: null, method: null, ambiguous: false };
  let candidates = roster.filter(
    (d) => nameTokensKey(d.displayName) === key || d.aliases.some((alias) => nameTokensKey(alias) === key),
  );
  if (candidates.length > 1) {
    // Two drivers share the name: only decide if exactly one of them worked this franchise on this date.
    const narrowed = candidates.filter((d) => assignedOn(d, source.franchiseId, source.date));
    if (narrowed.length !== 1) return { driverId: null, method: null, ambiguous: true };
    candidates = narrowed;
  }
  if (candidates.length === 1) return { driverId: candidates[0]!.id, method: "name", ambiguous: false };
  return { driverId: null, method: null, ambiguous: false };
}

/** Finds the one driver assigned to a vehicle on a date, if there is exactly one. */
export function matchDriverByVehicle(registration: string | null, date: ISODate, roster: RosterDriver[]): DriverMatch {
  if (!registration) return { driverId: null, method: null, ambiguous: false };
  const reg = registration.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const candidates = roster.filter((d) =>
    d.assignments.some((a) => a.vehicleRegistration === reg && a.startDate <= date && (a.endDate == null || a.endDate >= date)),
  );
  if (candidates.length === 1) return { driverId: candidates[0]!.id, method: null, ambiguous: false };
  return { driverId: null, method: null, ambiguous: candidates.length > 1 };
}

/**
 * Identifies which registered franchise a document belongs to by looking for
 * each franchise's FD number in the document text or file name. No assumption
 * is made about what an FD number looks like.
 */
export function matchFranchise(
  text: string,
  filename: string,
  franchises: RosterFranchise[],
): { franchiseId: string | null; ambiguous: boolean } {
  const haystack = `${filename}\n${text}`.toUpperCase();
  const found = franchises.filter((f) => {
    // Separators inside the FD number may be written differently (FD-123, FD 123, FD123),
    // but the match must not be part of a longer identifier.
    const parts = f.fdNumber.toUpperCase().split(/[\s\-_/]+/).filter(Boolean)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (parts.length === 0) return false;
    return new RegExp(`(^|[^A-Z0-9])${parts.join("[\\s\\-_/]*")}([^A-Z0-9]|$)`).test(haystack);
  });
  if (found.length === 1) return { franchiseId: found[0]!.id, ambiguous: false };
  return { franchiseId: null, ambiguous: found.length > 1 };
}

const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/\b(diesel|petrol|unleaded|fuel|adblue)\b/i, "Fuel"],
  [/\btyres?\b|\bpuncture\b/i, "Tyres"],
  [/\b(repair|bodywork|windscreen|breakdown|recovery)\b/i, "Repairs"],
  [/\b(service|servicing|mot|maintenance|brake pads?|oil change)\b/i, "Vehicle maintenance"],
  [/\binsurance\b/i, "Insurance"],
  [/\b(hire|rental|lease)\b/i, "Vehicle hire"],
  [/\b(parking|car park)\b/i, "Parking"],
  [/\b(equipment|scanner|uniform|trolley|sack truck|phone)\b/i, "Equipment"],
];

/** Picks an expense category by exact name first, then by obvious keywords, else the catch-all. */
export function matchCategory(
  categoryText: string | null,
  description: string,
  categories: { id: string; name: string }[],
): { id: string; name: string } | null {
  const byName = (name: string) => categories.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null;
  if (categoryText) {
    const exact = byName(categoryText.trim());
    if (exact) return exact;
  }
  const haystack = `${categoryText ?? ""} ${description}`;
  for (const [pattern, name] of CATEGORY_KEYWORDS) {
    if (pattern.test(haystack)) {
      const found = byName(name);
      if (found) return found;
    }
  }
  return byName("Other operating expenses");
}
