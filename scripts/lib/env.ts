import { existsSync } from "node:fs";

/** Loads .env.local if present, without overriding variables already set in the shell. */
export function loadLocalEnv(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
}

export function requireLocalDatabase(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    console.error("Refusing to continue: this script only runs against a local Supabase stack (NEXT_PUBLIC_SUPABASE_URL is not localhost).");
    process.exit(1);
  }
}

export function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
