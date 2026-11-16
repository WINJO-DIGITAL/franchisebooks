/** Loads .env.local then .env for command-line scripts (Node 22+). Real environment variables always win. */

import { existsSync } from "node:fs";

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

export function requireEnv(name: string, plainEnglish: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`\n✗ ${plainEnglish}\n  (set ${name} in .env.local or in the environment)\n`);
    process.exit(1);
  }
  return value;
}
