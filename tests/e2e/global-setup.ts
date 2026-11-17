import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Makes sure the local database holds the synthetic demo business (idempotent). */
export default function globalSetup() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
    throw new Error("End-to-end tests only run against a local Supabase stack.");
  }
  execSync("npm run -s seed:demo", { stdio: "inherit", env: process.env });
}
