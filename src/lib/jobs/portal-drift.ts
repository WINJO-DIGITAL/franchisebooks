import "server-only";
import { DRIFT_WINDOW_HOURS, assessPortalDrift, type DriftAssessment, type LayoutFailure } from "@/lib/dpd/drift";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sendAlert } from "@/lib/notify/alerts";
import type { AdminClient } from "@/lib/supabase/admin";

/** A six-hour slot such as "2026-11-21T06", so one alert goes out per slot at most. */
export function sixHourBucket(now: Date): string {
  const hour = Math.floor(now.getUTCHours() / 6) * 6;
  return `${now.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}`;
}

/**
 * Looks at the last day's failed DPD reads and, when they point to a change in the portal's pages rather than one account's
 * problem, emails the person who runs the service (ALERT_EMAIL) once per six hours. Never throws.
 */
export async function checkPortalDrift(db: AdminClient, now: Date = new Date()): Promise<DriftAssessment | null> {
  try {
    const since = new Date(now.getTime() - DRIFT_WINDOW_HOURS * 3_600_000).toISOString();
    const { data, error } = await db.from("sync_logs").select("account_id, import_job_id, detail, created_at")
      .eq("integration", "dpd").in("event", ["job_retry", "job_failed"]).eq("detail->>kind", "layout").gte("created_at", since).limit(500);
    if (error) return null;
    const failures: LayoutFailure[] = (data ?? []).flatMap((r) => {
      if (!r.import_job_id) return [];
      const step = (r.detail as { step?: unknown } | null)?.step;
      return [{ jobId: r.import_job_id, accountId: r.account_id, step: typeof step === "string" ? step : "unknown", at: r.created_at }];
    });
    const assessment = assessPortalDrift(failures, now);
    if (!assessment.suspected) return assessment;
    logger.warn({ ...assessment }, "DPD portal layout may have changed");
    await sendAlert(db, {
      key: "dpd-portal-drift",
      bucket: sixHourBucket(now),
      to: env.alertEmail(),
      subject: "Franchise Books: the DPD portal's pages may have changed",
      text: [
        `${assessment.jobs} DPD reads failed in the last ${DRIFT_WINDOW_HOURS} hours because a portal page did not look as expected, across ${assessment.accounts} account${assessment.accounts === 1 ? "" : "s"}.`,
        assessment.topStep ? `Most common step: ${assessment.topStep} (${assessment.topStepJobs} reads).` : "",
        "",
        "This usually means DPD changed its pages and the shared portal map needs updating. Run the discovery tool and compare with src/lib/dpd/portal-map.json. Customers see a plain message that the read failed and will be retried; nothing has been changed on the DPD side.",
        "",
        "At most one email is sent every six hours for this.",
      ].filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== "")).join("\n"),
    }, now);
    return assessment;
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "portal drift check failed");
    return null;
  }
}
