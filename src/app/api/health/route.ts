/**
 * Health check for uptime monitors and the production smoke test.
 *
 * Public (see PUBLIC_PATHS in the session proxy) and deliberately minimal: it
 * says whether the app is up and whether the database answers, and never
 * returns configuration values, keys, the code version, row data or error details.
 *
 *   GET /api/health  → 200 {"status":"ok"|"degraded", ...}   503 when the database is unreachable
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CheckState = "ok" | "failed" | "not_configured";

async function databaseState(): Promise<CheckState> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return "not_configured";
  try {
    // The auth service's own health endpoint: needs only the public key and touches no data.
    const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return response.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

export async function GET() {
  const database = await databaseState();
  const status = database === "ok" ? "ok" : "degraded";
  return NextResponse.json(
    {
      status,
      checks: { app: "ok", database },
      time: new Date().toISOString(),
    },
    { status: database === "failed" ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
