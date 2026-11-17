/** Shared helpers for the command-line scripts. */

import { existsSync } from "node:fs";

/** Loads .env.local then .env (Node 22+). Real environment variables always win. */
export function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) {
      try {
        process.loadEnvFile(file);
      } catch {
        // An unreadable env file is reported later as a missing variable.
      }
    }
  }
}

/** Kept for existing scripts. */
export const loadLocalEnv = loadEnvFiles;

export function requireEnv(name: string, plainEnglish: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`\n✗ ${plainEnglish}\n  (set ${name} in .env.local or in the environment)\n`);
    process.exit(1);
  }
  return value;
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
