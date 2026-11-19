/**
 * Which past periods to read next for the Max plan's history. Pure code, so the rules are tested without a database.
 */

import type { ISODate } from "@/lib/dates";
import { periodReadStatus, type Coverage } from "./coverage";
import type { HistoryPeriod } from "./window";

export interface HistoryReadPick {
  franchiseId: string;
  periodStart: ISODate;
}

/**
 * For each franchise, the newest periods that have not been read, up to `limit` each. Skips the current period (the normal
 * nightly read covers it), periods already read, queued or not listed by DPD, and periods whose reads keep failing.
 */
export function pickHistoryReads(input: {
  franchiseIds: string[];
  periods: HistoryPeriod[];
  coverage: Coverage;
  /** Failed reads so far, keyed `${franchiseId}|${periodStart}`. */
  failures: Map<string, number>;
  failureLimit: number;
  limit: number;
  /** History reads already queued for each franchise tonight; they count towards the limit. */
  alreadyTonight?: Map<string, number>;
}): HistoryReadPick[] {
  const picks: HistoryReadPick[] = [];
  const newestFirst = [...input.periods].filter((p) => !p.current).sort((a, b) => (a.start < b.start ? 1 : -1));
  for (const franchiseId of input.franchiseIds) {
    let taken = input.alreadyTonight?.get(franchiseId) ?? 0;
    for (const period of newestFirst) {
      if (taken >= input.limit) break;
      if (periodReadStatus(input.coverage, franchiseId, period.start) !== "not_read") continue;
      if ((input.failures.get(`${franchiseId}|${period.start}`) ?? 0) >= input.failureLimit) continue;
      picks.push({ franchiseId, periodStart: period.start });
      taken += 1;
    }
  }
  return picks;
}
