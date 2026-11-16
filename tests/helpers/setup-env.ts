import { existsSync } from "node:fs";

// Tests that touch the database use the local Supabase stack configured in .env.local.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.LOG_LEVEL = "silent";
