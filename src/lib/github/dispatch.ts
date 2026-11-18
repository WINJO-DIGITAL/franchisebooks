import "server-only";
import { env } from "@/lib/env";

export const SYNC_WORKFLOW = "dpd-sync.yml";

export type DispatchResult = { started: true } | { started: false; reason: "not_configured" | "refused"; message: string };

/**
 * Starts the nightly sync workflow on GitHub Actions now, by hand. Needs GITHUB_SYNC_TOKEN (a fine-grained token that can run
 * this repository's workflows). Runs at any time of day, because the window check only applies to scheduled runs.
 */
export async function dispatchSyncWorkflow(opts: { force: boolean }, fetchImpl: typeof fetch = fetch): Promise<DispatchResult> {
  const token = env.githubSyncToken();
  if (!token) return { started: false, reason: "not_configured", message: "Automatic starting from the website is not connected yet." };
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${env.githubRepo()}/actions/workflows/${SYNC_WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json" },
      // GitHub takes workflow inputs as text.
      body: JSON.stringify({ ref: "main", inputs: { force: String(opts.force), report_date: "" } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 204) return { started: true };
    return { started: false, reason: "refused", message: `GitHub did not start the sync (status ${res.status}). Check the token can run this repository's workflows.` };
  } catch (error) {
    return { started: false, reason: "refused", message: `GitHub could not be reached: ${error instanceof Error ? error.message : "unknown error"}.` };
  }
}

/**
 * Starts a run that processes whatever is waiting in the queue (a login just added at sign-up or in Settings), without queueing a
 * new sync of everyone's franchises. Several of these in a row collapse: GitHub keeps one run waiting behind the one in progress.
 * Never throws; a run that could not be started is picked up by the next scheduled run.
 */
export async function startWorkerRun(fetchImpl: typeof fetch = fetch): Promise<DispatchResult> {
  return dispatchSyncWorkflow({ force: false }, fetchImpl);
}
