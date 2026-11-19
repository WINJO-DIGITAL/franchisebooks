/**
 * Which DPD periods the app has read for each franchise, worked out from its DPD read jobs.
 *
 * A read is for one date, and the portal shows the whole four-week period that contains it, so a successful read of any day
 * covers that period up to that day. This is how a period with no payments is told apart from one that has not been read:
 *
 *   read        DPD was read for the period. No payments in it is a true zero.
 *   not_listed  DPD does not list the period (it is older than the portal keeps). Shown as not available, never as zero.
 *   queued      a read is waiting or running.
 *   not_read    nothing yet. Shown as missing, never as zero.
 *
 * Pure code.
 */

import type { ISODate } from "@/lib/dates";
import { periodContaining } from "@/lib/finance/periods";

export type PeriodReadStatus = "read" | "not_listed" | "queued" | "not_read";

export interface SyncJobRow {
  franchiseId: string | null;
  reportDate: ISODate | null;
  status: string;
  /** The job's result. A history read records `periodListed: false` when DPD does not list the period. */
  result: unknown;
}

/** Per franchise, per period start: what is known about reading it. */
export type Coverage = Map<string, Map<ISODate, Exclude<PeriodReadStatus, "not_read">>>;

const RANK: Record<Exclude<PeriodReadStatus, "not_read">, number> = { read: 3, not_listed: 2, queued: 1 };

function listedOf(result: unknown): boolean {
  return !(result && typeof result === "object" && (result as { periodListed?: unknown }).periodListed === false);
}

export function buildCoverage(jobs: SyncJobRow[]): Coverage {
  const coverage: Coverage = new Map();
  for (const job of jobs) {
    if (!job.franchiseId || !job.reportDate) continue;
    let status: Exclude<PeriodReadStatus, "not_read"> | null = null;
    if (job.status === "succeeded" || job.status === "partial") status = listedOf(job.result) ? "read" : "not_listed";
    else if (job.status === "queued" || job.status === "running") status = "queued";
    if (!status) continue;
    const start = periodContaining(job.reportDate).start;
    const periods: Map<ISODate, Exclude<PeriodReadStatus, "not_read">> = coverage.get(job.franchiseId) ?? new Map();
    const before = periods.get(start);
    // A read beats "not listed" and "queued": any successful read of the period is enough.
    if (!before || RANK[status] > RANK[before]) periods.set(start, status);
    coverage.set(job.franchiseId, periods);
  }
  return coverage;
}

export function periodReadStatus(coverage: Coverage, franchiseId: string, periodStart: ISODate): PeriodReadStatus {
  return coverage.get(franchiseId)?.get(periodStart) ?? "not_read";
}
