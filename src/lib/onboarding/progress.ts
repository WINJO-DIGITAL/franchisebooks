/**
 * Progress of a new customer's first DPD read, from their sync jobs. Pure code.
 *
 * One job per franchise. The newest job for each franchise counts. A job that failed and is waiting to be tried again is
 * still "queued", so it counts as unfinished rather than failed.
 */

export interface FirstSyncJob {
  status: string;
  franchiseId: string | null;
  /** Plain-English reason, set when a job could not finish. */
  errorMessage: string | null;
}

export type FirstSyncPhase = "working" | "done" | "needs_attention";

export interface FirstSyncProgress {
  phase: FirstSyncPhase;
  /** Franchises being read. */
  total: number;
  /** Franchises whose read has ended, successfully or not. */
  finished: number;
  /** Franchises read successfully (fully or partly). */
  succeeded: number;
  /** What went wrong, in plain English, when something did. */
  message: string | null;
}

const ENDED = new Set(["succeeded", "partial", "failed", "blocked", "cancelled"]);
const GOOD = new Set(["succeeded", "partial"]);

/** `jobs` newest first. `expectedFranchises` is how many franchises should have been queued. */
export function summariseFirstSync(jobs: FirstSyncJob[], expectedFranchises: number): FirstSyncProgress {
  const latest = new Map<string, FirstSyncJob>();
  for (const job of jobs) {
    const key = job.franchiseId ?? "none";
    if (!latest.has(key)) latest.set(key, job);
  }
  const current = [...latest.values()];
  const total = Math.max(expectedFranchises, current.length);
  const finished = current.filter((j) => ENDED.has(j.status)).length;
  const succeeded = current.filter((j) => GOOD.has(j.status)).length;
  const firstProblem = current.find((j) => !GOOD.has(j.status) && ENDED.has(j.status) && j.errorMessage)?.errorMessage ?? null;

  if (total === 0 || finished < total) return { phase: "working", total, finished, succeeded, message: null };
  if (succeeded === 0) {
    return { phase: "needs_attention", total, finished, succeeded, message: firstProblem ?? "We could not read your DPD account. Check your login details and try again." };
  }
  const partlyFailed = succeeded < total;
  return {
    phase: "done",
    total,
    finished,
    succeeded,
    message: partlyFailed ? `${total - succeeded} of ${total} franchises could not be read yet. ${firstProblem ?? "You can try them again from Data & Integrations."}`.trim() : null,
  };
}
