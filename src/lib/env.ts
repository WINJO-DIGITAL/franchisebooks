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

/**
 * Stripe settings follow STRIPE_MODE. With "live" they come only from the *_LIVE variables (STRIPE_SECRET_KEY_LIVE and so on),
 * never falling back to the test ones, so test and live values cannot be mixed. Anything else uses the test variables.
 */
function stripeSetting(name: string): string | null {
  return optional(optional("STRIPE_MODE") === "live" ? `${name}_LIVE` : name);
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
  /** The DPD portal address, shared by every account. The login itself is per account (see lib/dpd/login). */
  dpdPortalUrl: () => {
    const raw = optional("DPD_PORTAL_URL");
    return raw && z.url().safeParse(raw).success ? raw : null;
  },
  dpdLoginSecret: () => optional("DPD_LOGIN_SECRET"),
  /** Lets the website start the nightly GitHub workflow by hand. Optional: without it the button queues the job for the next run. */
  githubSyncToken: () => optional("GITHUB_SYNC_TOKEN"),
  githubRepo: () => optional("GITHUB_REPOSITORY") ?? "WINJO-DIGITAL/franchisebooks",
  /** Email sending (Resend). Both must be set for any email to go out. */
  resendApiKey: () => optional("RESEND_API_KEY"),
  emailFrom: () => optional("EMAIL_FROM"),
  /** Stripe billing. Without these the subscribe page says billing is not set up, and nothing is enforced. */
  stripeLive: () => optional("STRIPE_MODE") === "live",
  stripeSecretKey: () => stripeSetting("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => stripeSetting("STRIPE_WEBHOOK_SECRET"),
  stripePriceId: () => stripeSetting("STRIPE_PRICE_ID"),
  /** The customer portal set up for this app (plan changes, card, invoices, cancel). Optional: without it Stripe's default is used. */
  stripePortalConfigurationId: () => stripeSetting("STRIPE_PORTAL_CONFIGURATION_ID"),
  /** The Max plan (£99 a month). Optional: without it only the Essential plan is offered. */
  stripeMaxPriceId: () => stripeSetting("STRIPE_MAX_PRICE_ID"),
  /** When true, the app asks for a paid subscription. Off by default so turning billing on is a deliberate step. */
  billingEnforced: () => optional("BILLING_ENFORCED") === "true",
  logLevel: () => optional("LOG_LEVEL") ?? "info",
  errorWebhookUrl: () => optional("ERROR_WEBHOOK_URL"),
  /** Where error alerts are emailed (the person who runs the service). Without it, errors are only logged and sent to ERROR_WEBHOOK_URL. */
  alertEmail: () => {
    const raw = optional("ALERT_EMAIL");
    return raw && z.email().safeParse(raw).success ? raw : null;
  },
};
