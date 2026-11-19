import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { AdminClient } from "@/lib/supabase/admin";

export interface Email {
  to: string;
  subject: string;
  text: string;
  /** Optional files, such as a statement PDF. */
  attachments?: { filename: string; content: Buffer }[];
}

/**
 * Sends an email through Resend when RESEND_API_KEY and EMAIL_FROM are set. Until they are, nothing is sent and the
 * attempt is logged, so the rest of the app works the same without email.
 */
export async function sendEmail(mail: Email): Promise<boolean> {
  const key = env.resendApiKey();
  const from = env.emailFrom();
  if (!key || !from) {
    logger.info({ subject: mail.subject }, "email not sent: email sending is not configured yet");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from, to: [mail.to], subject: mail.subject, text: mail.text,
        ...(mail.attachments?.length ? { attachments: mail.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) logger.warn({ status: res.status, subject: mail.subject }, "email provider refused the message");
    return res.ok;
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error), subject: mail.subject }, "email could not be sent");
    return false;
  }
}

/** The email address of an account's owner, from their sign-in record. Null if it cannot be found. */
export async function ownerEmail(db: AdminClient, accountId: string): Promise<string | null> {
  const { data: owner } = await db.from("user_profiles").select("id").eq("account_id", accountId).eq("role", "owner").maybeSingle();
  if (!owner) return null;
  const { data } = await db.auth.admin.getUserById(owner.id);
  return data.user?.email ?? null;
}
