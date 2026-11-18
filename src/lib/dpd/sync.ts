/**
 * DPD portal jobs, run by the background worker.
 *
 *   dpd_sync       one franchise, one report date: sign in, collect each
 *                  report described by the portal map, and pass every
 *                  document to the shared import pipeline.
 *   dpd_discovery  walk the portal read-only and produce the capability
 *                  inventory.
 *
 * A failure on one report never stops the others: it is recorded with a
 * diagnostic screenshot and the job finishes as "partial".
 */

import "server-only";
import { formatUkDate, londonToday } from "@/lib/dates";
import { env } from "@/lib/env";
import { importDocument, type ImportOutcome } from "@/lib/ingest/pipeline";
import { importSelfBilledInvoice, type InvoiceImportOutcome } from "@/lib/ingest/invoice-import";
import type { Job, JobOutcome } from "@/lib/jobs/queue";
import { describeError, logger } from "@/lib/logger";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";
import { discoverPortal, inventoryMarkdown } from "./discovery";
import { PortalError } from "./errors";
import { portalMapSchema, type PortalMap } from "./portal-map";
import { PortalSession, type PortalCredentials } from "./session";
import { loadAllDpdLogins } from "./logins";
import { ownPortalMap } from "./readiness";
import { SHARED_PORTAL_MAP } from "./shared-map";

/** Keeps one signed-in session open across consecutive jobs so several franchises need only one sign-in. */
export class PortalSessionPool {
  private session: PortalSession | null = null;
  private key = "";

  async acquire(credentials: PortalCredentials, map: PortalMap): Promise<PortalSession> {
    const key = `${credentials.url}|${credentials.username}|${JSON.stringify(map.login)}`;
    if (this.session && this.key === key && this.session.signedIn) return this.session;
    await this.release();
    const session = await PortalSession.open(credentials, map);
    try {
      await session.login();
    } catch (error) {
      await session.close();
      throw error;
    }
    this.session = session;
    this.key = key;
    return session;
  }

  /** Drops the session after a failure so the next job starts from a clean sign-in. */
  async release(): Promise<void> {
    const session = this.session;
    this.session = null;
    this.key = "";
    if (session) await session.close();
  }
}

/** The portal map to use for an account: its own override if it has one, otherwise the setup shared by every account. */
export async function loadPortalMap(db: AdminClient, accountId: string): Promise<PortalMap> {
  const { data } = await db.from("integration_connections").select("config").eq("account_id", accountId).eq("provider", "dpd").maybeSingle();
  const raw = ownPortalMap(data?.config);
  if (!raw) return SHARED_PORTAL_MAP;
  const parsed = portalMapSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PortalError("config", "portal-map", "The DPD portal setup is not valid. Ask your developer to check it.", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

async function logSync(db: AdminClient, job: Job, level: "info" | "warning" | "error", event: string, message: string, detail: Record<string, unknown> = {}) {
  await db.from("sync_logs").insert({
    account_id: job.account_id, integration: "dpd", import_job_id: job.id, franchise_id: job.franchise_id, level, event, message, detail: detail as JsonObject,
  });
}

async function touchConnection(db: AdminClient, accountId: string, patch: { success?: boolean; error?: string | null }) {
  const now = new Date().toISOString();
  await db.from("integration_connections").upsert(
    {
      account_id: accountId, provider: "dpd", status: patch.error ? "error" : "connected", last_sync_at: now,
      ...(patch.success ? { last_success_at: now } : {}), last_error: patch.error ?? null,
    },
    { onConflict: "account_id,provider" },
  );
}

/**
 * The portal address from the worker's settings, with the DPD login that sees this franchise. A franchise linked to a
 * listed login uses that login; otherwise the account's first login (or its original single login) is used.
 */
async function credentialsFor(db: AdminClient, accountId: string, franchiseLoginId: string | null): Promise<PortalCredentials> {
  const url = env.dpdPortalUrl();
  if (!url) throw new PortalError("config", "credentials", "The DPD portal address has not been set on the background worker yet.", "DPD_PORTAL_URL missing");
  const logins = await loadAllDpdLogins(db, accountId);
  // A franchise with no link uses the original login, or the first listed one if there is no original.
  const login = franchiseLoginId ? logins.get(franchiseLoginId) : (logins.get("original") ?? logins.values().next().value);
  if (!login) throw new PortalError("config", "credentials", "No DPD portal login has been saved for this franchise. Add it in Settings.");
  return { url, username: login.username, password: login.password, loginSecret: env.dpdLoginSecret() };
}

export async function runDpdSyncJob(db: AdminClient, job: Job, pool: PortalSessionPool): Promise<JobOutcome> {
  if (!job.franchise_id) throw new PortalError("config", "job", "This sync was not linked to a franchise.");
  const date = job.report_date ?? londonToday();
  const { data: franchise } = await db.from("franchises").select("id, fd_number, dpd_login_id").eq("id", job.franchise_id).eq("account_id", job.account_id).maybeSingle();
  if (!franchise) throw new PortalError("config", "job", "The franchise for this sync no longer exists.");

  const map = await loadPortalMap(db, job.account_id);
  const credentials = await credentialsFor(db, job.account_id, franchise.dpd_login_id ?? null);

  let session: PortalSession;
  try {
    session = await pool.acquire(credentials, map);
    await session.openFranchise(franchise.fd_number, date);
  } catch (error) {
    await pool.release();
    throw error;
  }

  const outcomes: ImportOutcome[] = [];
  const invoices: InvoiceImportOutcome[] = [];
  const failures: { report: string; message: string }[] = [];
  // Invoices already stored are not downloaded again; a new invoice is fetched on the first night it is listed.
  const { data: storedInvoices } = await db.from("dpd_invoices").select("invoice_no").eq("account_id", job.account_id).eq("franchise_id", franchise.id);
  const knownInvoiceNumbers = new Set((storedInvoices ?? []).map((r) => r.invoice_no));

  for (const report of map.reports) {
    try {
      // Each report starts from the franchise's landing page.
      await session.openFranchise(franchise.fd_number, date);
      const documents = await session.collectReport(report, franchise.fd_number, date, { knownInvoiceNumbers });
      if (report.kind === "invoices") {
        for (const document of documents) {
          const outcome = await importSelfBilledInvoice(db, { accountId: job.account_id, franchiseId: franchise.id, fdNumber: franchise.fd_number, portalInvoiceNo: document.filename.replace(/\.pdf$/i, ""), bytes: document.bytes });
          invoices.push(outcome);
          if (outcome.status === "stored" && outcome.invoiceNo) knownInvoiceNumbers.add(outcome.invoiceNo);
          if (outcome.status !== "stored" || !outcome.reconciled) {
            await logSync(db, job, "warning", "invoice_needs_checking", outcome.message, { invoiceNo: outcome.invoiceNo, status: outcome.status, reconciled: outcome.reconciled });
          }
        }
        continue;
      }
      for (const document of documents) {
        outcomes.push(await importDocument(db, {
          accountId: job.account_id, source: "dpd_portal", sourceRef: document.sourceRef, filename: document.filename,
          mimeType: document.mimeType, bytes: document.bytes, franchiseHintId: franchise.id, importJobId: job.id,
        }));
      }
    } catch (error) {
      const portalError = error instanceof PortalError ? error : null;
      const plain = portalError?.plainEnglish ?? `The “${report.label}” report could not be collected.`;
      failures.push({ report: report.label, message: plain });

      // Diagnostics: a screenshot of where it went wrong, kept in private storage.
      let screenshotPath: string | null = null;
      const shot = await session.screenshot();
      if (shot) {
        screenshotPath = `${job.account_id}/${job.id}/${report.id}.png`;
        const upload = await db.storage.from("diagnostics").upload(screenshotPath, shot, { contentType: "image/png", upsert: true });
        if (upload.error) screenshotPath = null;
      }
      await logSync(db, job, "error", "report_failed", `${franchise.fd_number}: ${plain}`, {
        report: report.id, step: portalError?.step ?? "unknown", error: describeError(error), screenshotPath,
      });
      logger.warn({ jobId: job.id, report: report.id, step: portalError?.step }, "DPD report collection failed");
      if (portalError && (portalError.kind === "auth" || portalError.kind === "blocked")) {
        await pool.release();
        throw error;
      }
    }
  }

  const inserted = outcomes.reduce((n, o) => n + o.inserted, 0);
  const needsReview = outcomes.filter((o) => o.status === "needs_review" || o.status === "failed").length;
  const blockedWrites = session.guard.blocked.length;
  const invoicesStored = invoices.filter((i) => i.status === "stored").length;
  const invoicesToCheck = invoices.filter((i) => i.status !== "stored" || !i.reconciled).length;
  const result = { reportDate: date, documents: outcomes.length, inserted, needsReview, invoicesStored, invoicesToCheck, failures, blockedRequests: blockedWrites };

  if (outcomes.length === 0 && invoices.length === 0 && failures.length > 0) {
    await touchConnection(db, job.account_id, { error: failures[0]!.message });
    // Nothing at all could be collected: treat as a failure so it is retried.
    throw new PortalError("layout", "sync", failures[0]!.message, failures.map((f) => `${f.report}: ${f.message}`).join(" | "));
  }

  const parts = [`${inserted} new record${inserted === 1 ? "" : "s"} imported`];
  if (invoicesStored > 0) parts.push(`${invoicesStored} new invoice${invoicesStored === 1 ? "" : "s"} stored`);
  if (needsReview > 0) parts.push(`${needsReview} report${needsReview === 1 ? "" : "s"} need checking`);
  if (invoicesToCheck > 0) parts.push(`${invoicesToCheck} invoice${invoicesToCheck === 1 ? "" : "s"} need checking`);
  if (failures.length > 0) parts.push(`${failures.length} report${failures.length === 1 ? "" : "s"} could not be collected`);
  const clean = failures.length === 0 && needsReview === 0 && invoicesToCheck === 0;
  const message = `${franchise.fd_number}, ${formatUkDate(date)}: ${clean ? "DPD synchronised successfully. " : ""}${parts.join(", ")}.`;

  await touchConnection(db, job.account_id, { success: true });
  await logSync(db, job, clean ? "info" : "warning", "sync_finished", message, result);
  return { status: clean ? "succeeded" : "partial", message, result };
}

export async function runDpdDiscoveryJob(db: AdminClient, job: Job): Promise<JobOutcome> {
  const credentials = await credentialsFor(db, job.account_id, null);
  // Discovery only needs the login part of a map; the shared map has it (an account's own invalid override falls back to it too).
  const map: PortalMap = await loadPortalMap(db, job.account_id).catch(() => SHARED_PORTAL_MAP);

  const session = await PortalSession.open(credentials, map);
  try {
    await session.login();
    const discovery = await discoverPortal(session, { maxPages: Number((job.payload as { maxPages?: number } | null)?.maxPages ?? 60) });
    const markdown = inventoryMarkdown(discovery);
    const path = `${job.account_id}/${job.id}/portal-inventory.md`;
    await db.storage.from("diagnostics").upload(path, new TextEncoder().encode(markdown), { contentType: "text/markdown", upsert: true });
    const message = `Portal explored: ${discovery.pages.length} page type${discovery.pages.length === 1 ? "" : "s"} recorded${discovery.truncated ? " (page limit reached)" : ""}. Nothing in the portal was changed.`;
    await logSync(db, job, "info", "discovery_finished", message, { pages: discovery.pages.length, inventoryPath: path });
    return { status: "succeeded", message, result: { inventoryPath: path, discovery: discovery as unknown as JsonObject, markdown } };
  } finally {
    await session.close();
  }
}
