import "server-only";
import { londonToday } from "@/lib/dates";
import { env } from "@/lib/env";
import { logger, type ErrorDetail } from "@/lib/logger";
import { sendEmail } from "@/lib/notify/email";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * Alert emails, rate-limited so a run of the same failure sends one email, not hundreds.
 *
 * Each alert has a key (what went wrong) and a bucket (a time slot such as the hour or the night). The first alert for a
 * key in a bucket is sent; later ones in the same bucket are skipped. On top of that, no more than DAILY_ALERT_CAP alert
 * emails go out in any 24 hours, so a fault that keeps changing its message still cannot flood an inbox.
 */
export const DAILY_ALERT_CAP = 20;

export type AlertResult = "sent" | "duplicate" | "capped" | "no_recipient" | "not_sent";

/** The UTC hour an alert falls in, such as "2026-11-19T20". */
export function hourBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13);
}

/**
 * The key for an error alert: where it happened plus the start of its message, with numbers and ids taken out so the same
 * fault with a different job id counts as the same alert.
 */
export function errorAlertKey(detail: Pick<ErrorDetail, "message">, context: Record<string, unknown> = {}): string {
  const where = String(context.where ?? context.type ?? "app");
  const message = detail.message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `error:${where}:${message}`.slice(0, 200);
}

export async function sendAlert(
  db: AdminClient,
  alert: { key: string; bucket: string; to: string | null; subject: string; text: string },
  now: Date = new Date(),
): Promise<AlertResult> {
  if (!alert.to) return "no_recipient";
  // Where email is not set up (for example a worker without RESEND_API_KEY), only log it and leave the slot unclaimed, so a
  // server that can send email still sends this alert.
  if (!env.resendApiKey() || !env.emailFrom()) {
    logger.warn({ alert: alert.key }, `alert not emailed (email is not set up here): ${alert.subject}`);
    return "not_sent";
  }
  const since = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const { count } = await db.from("alert_log").select("alert_key", { count: "exact", head: true }).gte("sent_at", since);
  if ((count ?? 0) >= DAILY_ALERT_CAP) return "capped";
  // Claim the slot first: if two servers raise the same alert together, only one insert succeeds.
  const { error } = await db.from("alert_log").insert({ alert_key: alert.key, bucket: alert.bucket, recipient: alert.to, sent_at: now.toISOString() });
  if (error) return error.code === "23505" ? "duplicate" : "not_sent";
  const sent = await sendEmail({ to: alert.to, subject: alert.subject, text: alert.text });
  // Not delivered: give the slot back so the next attempt can try again.
  if (!sent) await db.from("alert_log").delete().eq("alert_key", alert.key).eq("bucket", alert.bucket);
  return sent ? "sent" : "not_sent";
}

/**
 * Emails the person who runs the service (ALERT_EMAIL) about an error, at most once an hour for the same error.
 * Never throws: an alert must not break the request it is reporting on.
 */
export async function alertAdminOfError(detail: ErrorDetail, context: Record<string, unknown> = {}): Promise<AlertResult> {
  const to = env.alertEmail();
  if (!to) return "no_recipient";
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const lines = [
      `An error was logged by Franchise Books (${process.env.SERVICE_NAME ?? "web"}).`,
      "",
      `What: ${detail.message}`,
      context.where ? `Where: ${String(context.where)}` : null,
      context.type ? `Job: ${String(context.type)}` : null,
      context.jobId ? `Job id: ${String(context.jobId)}` : null,
      `When: ${new Date().toISOString()}`,
      "",
      "The same error is emailed at most once an hour. Look in the Vercel or GitHub Actions logs for the full details.",
    ].filter((l): l is string => l !== null);
    return await sendAlert(createAdminClient(), {
      key: errorAlertKey(detail, context),
      bucket: hourBucket(),
      to,
      subject: `Franchise Books error: ${detail.message.slice(0, 70)}`,
      text: lines.join("\n"),
    });
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "error alert could not be sent");
    return "not_sent";
  }
}

/** Emails an account's owner about a failed DPD read: at most once per account per night, however many franchises fail. */
export async function alertOwnerOfSyncFailure(db: AdminClient, accountId: string, to: string | null, problem: string, now: Date = new Date()): Promise<AlertResult> {
  try {
    return await sendAlert(db, {
      key: `dpd-read-failed:${accountId}`,
      bucket: londonToday(now),
      to,
      subject: "Franchise Books could not read your DPD account",
      text: `Tonight's read of your DPD account did not finish.\n\n${problem}\n\nOpen Settings in Franchise Books to check your DPD logins. Nothing has been changed on the DPD side.`,
    }, now);
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, "sync failure email could not be sent");
    return "not_sent";
  }
}
