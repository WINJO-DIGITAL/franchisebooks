/**
 * Environment access. Values are read lazily and validated when first used, so
 * a missing optional integration never stops the rest of the app from working.
 * Nothing here is ever sent to the browser except the two NEXT_PUBLIC values.
 */

import { z } from "zod";

export class MissingConfigError extends Error {
  constructor(public readonly variable: string, public readonly plainEnglish: string) {
    super(`Missing environment variable ${variable}`);
    this.name = "MissingConfigError";
  }
}

function required(name: string, plainEnglish: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new MissingConfigError(name, plainEnglish);
  return value;
}

function optional(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL", "The database connection has not been configured."),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY", "The database connection has not been configured."),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY", "The server database key has not been configured."),
  appUrl: () => (optional("APP_URL") ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/$/, ""),
  encryptionKey: () => {
    const raw = required("ENCRYPTION_KEY", "The encryption key for stored connections has not been configured.");
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new MissingConfigError("ENCRYPTION_KEY", "The encryption key must be 32 bytes, base64 encoded.");
    return key;
  },
  cronSecret: () => optional("CRON_SECRET"),
  workerUrl: () => optional("WORKER_URL")?.replace(/\/$/, "") ?? null,
  workerAuthToken: () => optional("WORKER_AUTH_TOKEN"),
  dropbox: () => {
    const appKey = optional("DROPBOX_APP_KEY");
    const appSecret = optional("DROPBOX_APP_SECRET");
    if (!appKey || !appSecret) return null;
    return {
      appKey,
      appSecret,
      redirectUrl: optional("DROPBOX_REDIRECT_URL") ?? `${env.appUrl()}/api/dropbox/callback`,
    };
  },
  dpd: () => {
    const parsed = z
      .object({ url: z.url(), username: z.string().min(1), password: z.string().min(1), loginSecret: z.string().nullable() })
      .safeParse({
        url: optional("DPD_PORTAL_URL"),
        username: optional("DPD_USERNAME"),
        password: optional("DPD_PASSWORD"),
        loginSecret: optional("DPD_LOGIN_SECRET"),
      });
    return parsed.success ? parsed.data : null;
  },
  logLevel: () => optional("LOG_LEVEL") ?? "info",
  errorWebhookUrl: () => optional("ERROR_WEBHOOK_URL"),
};
