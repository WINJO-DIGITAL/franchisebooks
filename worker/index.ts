/**
 * Background worker.
 *
 * A small always-on Node service that runs the jobs Vercel cannot: anything
 * needing a real browser (the DPD portal), plus — so the system keeps working
 * on any Vercel plan — the scheduler tick and the lighter jobs too.
 *
 *   POST /run     (Bearer WORKER_AUTH_TOKEN)  wake up and drain the queue now
 *   GET  /health                               liveness + last activity
 *
 * It also polls on its own timer, so a missed wake-up call only delays work.
 */

import { createServer } from "node:http";
import { hostname } from "node:os";
import { bearerMatches } from "@/lib/crypto";
import { PortalSessionPool } from "@/lib/dpd/sync";
import { APP_JOB_TYPES, WORKER_JOB_TYPES, type JobType } from "@/lib/jobs/queue";
import { drainJobs, runSchedulerTick } from "@/lib/jobs/run";
import { describeError, logger, reportError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

process.env.SERVICE_NAME ??= "worker";

const PORT = Number(process.env.PORT ?? 8787);
const POLL_MS = Number(process.env.WORKER_POLL_SECONDS ?? 60) * 1000;
const TICK_MS = Number(process.env.WORKER_TICK_SECONDS ?? 300) * 1000;
const WORKER_ID = `${hostname()}-${process.pid}`;
const TOKEN = process.env.WORKER_AUTH_TOKEN?.trim();
/** Set WORKER_DPD_ONLY=true to leave the lighter jobs to the web app. */
const TYPES: JobType[] = process.env.WORKER_DPD_ONLY === "true" ? WORKER_JOB_TYPES : [...WORKER_JOB_TYPES, ...APP_JOB_TYPES];

if (!TOKEN || TOKEN.length < 24) {
  logger.fatal("WORKER_AUTH_TOKEN is missing or too short (use at least 24 random characters). Refusing to start.");
  process.exit(1);
}

const state = { draining: false, again: false, lastDrainAt: null as string | null, lastTickAt: null as string | null, jobsRun: 0, startedAt: new Date().toISOString() };
const pool = new PortalSessionPool();

async function drain(reason: string): Promise<void> {
  if (state.draining) {
    state.again = true; // something arrived while busy: go round once more afterwards
    return;
  }
  state.draining = true;
  try {
    do {
      state.again = false;
      const ran = await drainJobs(createAdminClient(), { workerId: WORKER_ID, types: TYPES, maxJobs: 50, portalPool: pool });
      state.jobsRun += ran;
      if (ran > 0) logger.info({ ran, reason }, "Jobs processed");
    } while (state.again);
  } catch (error) {
    await reportError(error, { where: "worker.drain" });
  } finally {
    // Never leave a signed-in portal session open while idle.
    await pool.release().catch(() => undefined);
    state.draining = false;
    state.lastDrainAt = new Date().toISOString();
  }
}

async function tick(): Promise<void> {
  try {
    const result = await runSchedulerTick(createAdminClient());
    state.lastTickAt = new Date().toISOString();
    const queued = Object.values(result.queued).reduce((a, b) => a + b, 0);
    if (queued > 0 || result.released > 0) logger.info(result, "Scheduler tick queued work");
    if (queued > 0) void drain("tick");
  } catch (error) {
    logger.warn({ err: describeError(error) }, "Scheduler tick failed");
  }
}

const server = createServer((request, response) => {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  };
  const path = (request.url ?? "/").split("?")[0];
  if (request.method === "GET" && path === "/health") {
    send(200, { ok: true, draining: state.draining, lastDrainAt: state.lastDrainAt, lastTickAt: state.lastTickAt, startedAt: state.startedAt });
    return;
  }
  if (request.method === "POST" && path === "/run") {
    if (!bearerMatches(request.headers.authorization, TOKEN)) {
      send(401, { error: "Unauthorised" });
      return;
    }
    void drain("poke");
    send(202, { accepted: true });
    return;
  }
  send(404, { error: "Not found" });
});

server.listen(PORT, () => {
  logger.info({ port: PORT, workerId: WORKER_ID, types: TYPES }, "Worker started");
  void tick().then(() => drain("startup"));
});
const pollTimer = setInterval(() => void drain("poll"), POLL_MS);
const tickTimer = setInterval(() => void tick(), TICK_MS);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Worker stopping");
  clearInterval(pollTimer);
  clearInterval(tickTimer);
  server.close();
  const deadline = Date.now() + 25_000;
  while (state.draining && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
  await pool.release().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
