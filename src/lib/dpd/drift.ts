/**
 * Spotting a change to the DPD portal's pages. A layout failure on one account can be that account's own problem; the same
 * failure on several accounts, or repeated at the same step, means DPD changed something and the shared portal map needs
 * updating. Pure code: counts what the logs already show and estimates nothing.
 */

/** A DPD read that failed because the portal page did not look as the map expects. */
export interface LayoutFailure {
  jobId: string;
  accountId: string;
  /** The step that failed, such as "payments:table". */
  step: string;
  /** When it was logged (ISO instant). */
  at: string;
}

export const DRIFT_WINDOW_HOURS = 24;
/** Fewer failed reads than this is not enough to say the portal has changed. */
export const DRIFT_MIN_JOBS = 3;

export interface DriftAssessment {
  suspected: boolean;
  /** Distinct failed reads in the window. */
  jobs: number;
  /** Distinct accounts affected. */
  accounts: number;
  /** The step that failed in most reads, if any. */
  topStep: string | null;
  topStepJobs: number;
}

/**
 * The portal is suspected of having changed when at least DRIFT_MIN_JOBS reads failed on layout in the window and either they
 * span more than one account or the same step failed in all of those reads' worth (at least DRIFT_MIN_JOBS times).
 */
export function assessPortalDrift(failures: LayoutFailure[], now: Date): DriftAssessment {
  const since = now.getTime() - DRIFT_WINDOW_HOURS * 3_600_000;
  const jobs = new Map<string, LayoutFailure>();
  for (const f of failures) {
    if (Date.parse(f.at) < since) continue;
    if (!jobs.has(f.jobId)) jobs.set(f.jobId, f);
  }
  const accounts = new Set([...jobs.values()].map((f) => f.accountId));
  const perStep = new Map<string, number>();
  for (const f of jobs.values()) perStep.set(f.step, (perStep.get(f.step) ?? 0) + 1);
  let topStep: string | null = null;
  let topStepJobs = 0;
  for (const [step, n] of perStep) {
    if (n > topStepJobs || (n === topStepJobs && topStep !== null && step < topStep)) {
      topStep = step;
      topStepJobs = n;
    }
  }
  const suspected = jobs.size >= DRIFT_MIN_JOBS && (accounts.size > 1 || topStepJobs >= DRIFT_MIN_JOBS);
  return { suspected, jobs: jobs.size, accounts: accounts.size, topStep, topStepJobs };
}
