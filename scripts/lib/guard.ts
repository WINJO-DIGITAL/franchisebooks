/**
 * Safety checks for scripts that write synthetic data.
 *
 * The rule: demo data may only go into a local database, or into a clearly
 * marked preview database when the person running the script says so in
 * words. It must never reach production. Pure functions, so they are tested.
 */

export interface GuardInput {
  supabaseUrl: string;
  env: Record<string, string | undefined>;
}

export interface GuardResult {
  allowed: boolean;
  /** Plain-English reason, shown to whoever ran the script. */
  reason: string;
  target: "local" | "preview" | "refused";
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "host.docker.internal", "kong"]);

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function checkDemoSeedAllowed({ supabaseUrl, env }: GuardInput): GuardResult {
  const host = hostOf(supabaseUrl);
  if (!host) return { allowed: false, target: "refused", reason: "The database address is not a valid web address, so the demo data was not added." };

  const looksProduction =
    env.VERCEL_ENV === "production" ||
    env.NODE_ENV === "production" ||
    env.APP_ENV === "production" ||
    (!!env.PRODUCTION_SUPABASE_URL && hostOf(env.PRODUCTION_SUPABASE_URL) === host);

  if (LOCAL_HOSTS.has(host)) {
    // A local database address wins even if NODE_ENV happens to be set to production by a tool.
    return { allowed: true, target: "local", reason: "Local database." };
  }
  if (looksProduction) {
    return { allowed: false, target: "refused", reason: "This looks like the live system. Demo data is never added to production." };
  }
  if (env.ALLOW_DEMO_SEED_PREVIEW !== "yes") {
    return {
      allowed: false,
      target: "refused",
      reason: `${host} is not a local database. To add demo data to a preview database, set ALLOW_DEMO_SEED_PREVIEW=yes. Never do this for the live system.`,
    };
  }
  return { allowed: true, target: "preview", reason: "Preview database, confirmed by ALLOW_DEMO_SEED_PREVIEW=yes." };
}

/** Names of the accounts the demo seed creates. Anything else found in a non-local database means real data. */
export const DEMO_ACCOUNT_NAME = "Demo Couriers Ltd";
export const DEMO_EMAIL = "demo.owner@example.test";
