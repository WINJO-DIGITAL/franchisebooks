/**
 * Structured logging with secret redaction, plus optional error forwarding.
 * Log lines are JSON so they can be searched in Vercel / the worker host.
 */

import pino from "pino";
import { env } from "./env";

const REDACT = [
  "password", "*.password", "token", "*.token", "access_token", "*.access_token", "refresh_token", "*.refresh_token",
  "authorization", "*.authorization", "headers.authorization", "headers.cookie", "secret", "*.secret", "apiKey", "*.apiKey",
  "ciphertext", "*.ciphertext", "DPD_PASSWORD", "DPD_USERNAME", "DPD_LOGIN_SECRET",
];

export const logger = pino({
  level: env.logLevel(),
  base: { service: process.env.SERVICE_NAME ?? "web" },
  redact: { paths: REDACT, censor: "[redacted]" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;

/** Removes anything that looks like a credential from free text before it is stored or shown. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const name of ["DPD_PASSWORD", "DPD_USERNAME", "DPD_LOGIN_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "DROPBOX_APP_SECRET", "WORKER_AUTH_TOKEN", "CRON_SECRET"]) {
    const value = process.env[name];
    if (value && value.length >= 4) out = out.split(value).join("[redacted]");
  }
  return out
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[redacted]")
    .replace(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, "[redacted-jwt]")
    .replace(/(sl\.[A-Za-z0-9_\-]{20,})/g, "[redacted-token]");
}

export interface ErrorDetail {
  name: string;
  message: string;
  stack?: string;
  step?: string;
  [key: string]: unknown;
}

export function describeError(error: unknown, extra: Record<string, unknown> = {}): ErrorDetail {
  const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
  return {
    name: e.name,
    message: scrubSecrets(e.message),
    stack: e.stack ? scrubSecrets(e.stack).split("\n").slice(0, 12).join("\n") : undefined,
    ...extra,
  };
}

/** Logs an error, emails ALERT_EMAIL (at most once an hour per error) and, if configured, forwards it to an error tracker. Never throws. */
export async function reportError(error: unknown, context: Record<string, unknown> = {}): Promise<void> {
  const detail = describeError(error);
  logger.error({ err: detail, ...context }, detail.message);
  // Email the person who runs the service (ALERT_EMAIL), rate-limited. Loaded here so the logger has no database import.
  if (env.alertEmail()) {
    try {
      const { alertAdminOfError } = await import("./notify/alerts");
      await alertAdminOfError(detail, context);
    } catch {
      // An alert must never break the request it is reporting on.
    }
  }
  const url = env.errorWebhookUrl();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "error", service: process.env.SERVICE_NAME ?? "web", at: new Date().toISOString(), error: detail, context }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Error tracking must never break the request it is reporting on.
  }
}
