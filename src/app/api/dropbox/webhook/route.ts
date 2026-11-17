import { after, NextResponse, type NextRequest } from "next/server";
import { hmacSha256Hex, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs/queue";
import { drainJobs } from "@/lib/jobs/run";
import { reportError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Dropbox verifies the webhook URL by asking it to echo a challenge. */
export function GET(request: NextRequest) {
  const challenge = request.nextUrl.searchParams.get("challenge");
  if (!challenge) return new NextResponse("Missing challenge", { status: 400 });
  return new NextResponse(challenge, { headers: { "content-type": "text/plain", "x-content-type-options": "nosniff" } });
}

/**
 * Dropbox change notification. The body only says WHICH accounts changed;
 * the signature proves it came from Dropbox. A sync job is queued for each
 * matching connection and processed after the response has been sent.
 */
export async function POST(request: NextRequest) {
  const config = env.dropbox();
  if (!config) return new NextResponse("Not configured", { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("x-dropbox-signature") ?? "";
  if (!signature || !safeEqual(signature, hmacSha256Hex(config.appSecret, raw))) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  let accounts: string[] = [];
  try {
    const body = JSON.parse(raw) as { list_folder?: { accounts?: unknown } };
    if (Array.isArray(body.list_folder?.accounts)) accounts = body.list_folder.accounts.filter((a): a is string => typeof a === "string").slice(0, 50);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  if (accounts.length === 0) return NextResponse.json({ ok: true, queued: 0 });

  const db = createAdminClient();
  const { data: connections } = await db.from("integration_connections").select("account_id").eq("provider", "dropbox").eq("status", "connected").in("external_account_id", accounts);
  let queued = 0;
  for (const connection of connections ?? []) {
    await enqueueJob(db, { accountId: connection.account_id, type: "dropbox_sync", trigger: "webhook" });
    queued += 1;
  }
  if (queued > 0) {
    after(async () => {
      try {
        await drainJobs(db, { workerId: `webhook-${Date.now()}`, types: ["dropbox_sync"], maxJobs: 5, deadline: Date.now() + 240_000 });
      } catch (error) {
        await reportError(error, { where: "dropbox.webhook" });
      }
    });
  }
  return NextResponse.json({ ok: true, queued });
}
