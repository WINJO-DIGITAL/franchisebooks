import { NextResponse, type NextRequest } from "next/server";
import { bearerMatches } from "@/lib/crypto";
import { env } from "@/lib/env";
import { APP_JOB_TYPES } from "@/lib/jobs/queue";
import { drainJobs, pokeWorker, runSchedulerTick } from "@/lib/jobs/run";
import { reportError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduler entry point, called by Vercel Cron with
 * "Authorization: Bearer $CRON_SECRET". Queues whatever is due, wakes the
 * worker for browser jobs, and runs the light jobs here.
 */
export async function GET(request: NextRequest) {
  const secret = env.cronSecret();
  if (!secret || !bearerMatches(request.headers.get("authorization"), secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    const db = createAdminClient();
    const tick = await runSchedulerTick(db);
    const worker = await pokeWorker();
    const ran = await drainJobs(db, { workerId: `vercel-cron-${Date.now()}`, types: APP_JOB_TYPES, maxJobs: 10, deadline: Date.now() + 240_000 });
    return NextResponse.json({ ok: true, tick, workerPoked: worker.ok, appJobsRun: ran });
  } catch (error) {
    await reportError(error, { where: "cron.tick" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
