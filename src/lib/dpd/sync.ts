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
import { enqueueJob, type Job, type JobOutcome } from "@/lib/jobs/queue";
import { describeError, logger } from "@/lib/logger";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";
import { discoverPortal, inventoryMarkdown } from "./discovery";
import { PERIOD_NOT_LISTED, PortalError } from "./errors";
import { portalMapSchema, type PortalMap } from "./portal-map";
import { PortalSession, type PortalCredentials } from "./session";
import { alertOwnerOfSyncFailure } from "@/lib/notify/alerts";
import { ownerEmail } from "@/lib/notify/email";
import { listDpdLogins, loadAllDpdLogins, loadDpdLoginById, recordLoginOutcome } from "./logins";
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
  if (patch.error) {
    // Tell the owner when a read goes wrong, rather than leaving them to find it on payday: once a night, not once per retry.
    const to = await ownerEmail(db, accountId).catch(() => null);
    await alertOwnerOfSyncFailure(db, accountId, to, patch.error);
  }
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
  // A Max plan history read of a past period: invoices are left to the normal reads, and a period DPD does not list is an
  // answer in itself ("not available"), not a failure to retry.
  const history = (job.payload as { history?: unknown } | null)?.history === true;
  const notListed: string[] = [];
  // Invoices already stored and adding up (for any franchise in the business: one login can list a sibling franchise's
  // invoices) are not downloaded again; a new invoice is fetched on the first night it is listed. A stored invoice whose lines
  // did not add up is fetched and read again each night, so an improved reading puts it right.
  const [{ data: storedInvoices }, { data: accountFranchises }] = await Promise.all([
    db.from("dpd_invoices").select("invoice_no, reconciled").eq("account_id", job.account_id),
    db.from("franchises").select("id, fd_number").eq("account_id", job.account_id),
  ]);
  const knownInvoiceNumbers = new Set((storedInvoices ?? []).filter((r) => r.reconciled).map((r) => r.invoice_no));
  const siblings = (accountFranchises ?? []).map((f) => ({ id: f.id, fdNumber: f.fd_number }));

  for (const report of map.reports) {
    if (history && report.kind === "invoices") continue;
    try {
      // Each report starts from the franchise's landing page.
      await session.openFranchise(franchise.fd_number, date);
      const documents = await session.collectReport(report, franchise.fd_number, date, { knownInvoiceNumbers });
      if (report.kind === "invoices") {
        for (const document of documents) {
          const outcome = await importSelfBilledInvoice(db, {
            accountId: job.account_id, franchiseId: franchise.id, fdNumber: franchise.fd_number, portalInvoiceNo: document.filename.replace(/\.pdf$/i, ""),
            bytes: document.bytes, accountFranchises: siblings,
          });
          invoices.push(outcome);
          if (outcome.status === "stored" && outcome.invoiceNo) knownInvoiceNumbers.add(outcome.invoiceNo);
          if (outcome.recheck) {
            // A fresh reading of an invoice already reported: say so only when it now adds up; otherwise stay quiet.
            if (outcome.reconciled) await logSync(db, job, "info", "invoice_rechecked", `Invoice ${outcome.invoiceNo} now adds up and is counted.`, { invoiceNo: outcome.invoiceNo });
            continue;
          }
          if (outcome.status !== "stored" || !outcome.totalsAgree) {
            await logSync(db, job, "warning", "invoice_needs_checking", outcome.message, {
              invoiceNo: outcome.invoiceNo, status: outcome.status, reconciled: outcome.reconciled, fdRead: outcome.fdRead ?? null, diagnosticsPath: outcome.diagnosticsPath ?? null, pdfPath: outcome.pdfPath ?? null,
            });
            // Also in the run's own log, so the reason can be seen in GitHub Actions without opening the database.
            logger.warn({ jobId: job.id, invoiceNo: outcome.invoiceNo, status: outcome.status, fdRead: outcome.fdRead ?? null }, outcome.message);
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
      if (history && portalError?.step === `${report.id}:${PERIOD_NOT_LISTED}`) {
        notListed.push(report.label);
        continue;
      }
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

  if (history && notListed.length > 0 && outcomes.length === 0 && failures.length === 0) {
    // DPD's Period drop-down does not go back this far. Recorded, so the period is shown as not available and not asked for again.
    const message = `${franchise.fd_number}, period containing ${formatUkDate(date)}: DPD does not list this period, so there is nothing to read.`;
    await logSync(db, job, "info", "history_period_not_listed", message, { reportDate: date, reports: notListed });
    return { status: "succeeded", message, result: { reportDate: date, history: true, periodListed: false, documents: 0, inserted: 0 } };
  }

  const inserted = outcomes.reduce((n, o) => n + o.inserted, 0);
  const needsReview = outcomes.filter((o) => o.status === "needs_review" || o.status === "failed").length;
  const blockedWrites = session.guard.blocked.length;
  const invoicesStored = invoices.filter((i) => i.status === "stored" && !i.recheck).length;
  // An invoice needs checking by hand only when its own printed totals disagree. One whose totals agree but whose lines could
  // not be read exactly is stored as it stands.
  const invoicesToCheck = invoices.filter((i) => !i.recheck && (i.status !== "stored" || !i.totalsAgree)).length;
  const result = { reportDate: date, history, documents: outcomes.length, inserted, needsReview, invoicesStored, invoicesToCheck, failures, blockedRequests: blockedWrites };

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

/**
 * For each listed login that has no franchises yet, signs in with it, reads the FD numbers it can see, adds the new ones to the
 * account and queues their first read. A login that fails is marked with the reason (shown in Settings) and the others still run.
 * Read-only on the DPD side: it signs in and reads one drop-down.
 */
async function runLoginFranchiseDiscovery(db: AdminClient, job: Job): Promise<JobOutcome> {
  const url = env.dpdPortalUrl();
  if (!url) throw new PortalError("config", "credentials", "The DPD portal address has not been set on the background worker yet.", "DPD_PORTAL_URL missing");
  // A refresh targets one login: check it signs in, pick up any new franchises, and queue a read for each of its franchises.
  const refreshLoginId = (job.payload as { refreshLoginId?: string } | null)?.refreshLoginId ?? null;
  const waitingLogins = async (excluded: Set<string>) => {
    const logins = await listDpdLogins(db, job.account_id);
    if (refreshLoginId) return logins.filter((l) => l.id === refreshLoginId && !excluded.has(l.id));
    const { data: linked } = await db.from("franchises").select("dpd_login_id").eq("account_id", job.account_id).not("dpd_login_id", "is", null);
    const linkedIds = new Set((linked ?? []).map((r) => r.dpd_login_id));
    return logins.filter((l) => !linkedIds.has(l.id) && !excluded.has(l.id));
  };
  const attempted = new Set<string>();
  let pending = await waitingLogins(attempted);
  if (pending.length === 0) return { status: "succeeded", message: "No logins are waiting to have their franchises found." };

  const map = await loadPortalMap(db, job.account_id).catch(() => SHARED_PORTAL_MAP);
  const { data: existing } = await db.from("franchises").select("fd_number").eq("account_id", job.account_id);
  const known = new Set((existing ?? []).map((f) => f.fd_number));
  const newFranchiseIds: string[] = [];
  let already = 0;
  let succeeded = 0;
  let firstError: unknown = null;

  // A login added while this job is running would be missed (a second job cannot start), so look again before finishing.
  for (let pass = 0; pass < 3 && pending.length > 0; pass++) {
    for (const login of pending) {
      attempted.add(login.id);
      const secret = await loadDpdLoginById(db, login.id);
      if (!secret) {
        await recordLoginOutcome(db, login.id, { error: "The saved password could not be read. Remove this login and add it again." });
        firstError ??= new PortalError("config", "credentials", "The saved password for a login could not be read. Remove the login and add it again.");
        continue;
      }
      const session = await PortalSession.open({ url, username: secret.username, password: secret.password, loginSecret: env.dpdLoginSecret() }, map);
      try {
        await session.login();
        const fds = await session.listFranchiseNumbers();
        if (fds.length === 0) throw new PortalError("layout", "franchises:list", "This login signed in, but no franchise numbers were listed for it.");
        for (const fd of fds) {
          if (known.has(fd)) { already += 1; continue; }
          const { data: created, error } = await db.from("franchises").insert({ account_id: job.account_id, fd_number: fd, name: "", dpd_login_id: login.id }).select("id").single();
          if (error) throw new Error(`Could not add ${fd}: ${error.message}`);
          known.add(fd);
          newFranchiseIds.push(created.id);
        }
        await recordLoginOutcome(db, login.id, { success: true, error: null });
        succeeded += 1;
      } catch (error) {
        await recordLoginOutcome(db, login.id, { error: error instanceof PortalError ? error.plainEnglish : "Something went wrong reading this login. It will be tried again." });
        firstError ??= error;
      } finally {
        await session.close();
      }
    }
    pending = await waitingLogins(attempted);
  }

  // The new franchises are read straight away, so their figures appear without waiting for tonight. A refresh also re-reads
  // the login's existing franchises, which is what "refresh" is for.
  const readIds = [...newFranchiseIds];
  if (refreshLoginId) {
    const { data: mine } = await db.from("franchises").select("id").eq("account_id", job.account_id).eq("dpd_login_id", refreshLoginId).eq("is_active", true);
    for (const f of mine ?? []) if (!readIds.includes(f.id)) readIds.push(f.id);
  }
  for (const franchiseId of readIds) {
    await enqueueJob(db, { accountId: job.account_id, type: "dpd_sync", franchiseId, reportDate: londonToday(), trigger: "manual", requestedBy: job.requested_by ?? undefined });
  }
  if (succeeded === 0 && firstError) throw firstError;
  const parts = [`${newFranchiseIds.length} new franchise${newFranchiseIds.length === 1 ? "" : "s"} found`];
  if (already > 0) parts.push(`${already} already on your account`);
  const failed = attempted.size - succeeded;
  if (failed > 0) parts.push(`${failed} login${failed === 1 ? "" : "s"} could not be read`);
  const message = `${parts.join(", ")}.`;
  await logSync(db, job, failed > 0 ? "warning" : "info", "franchises_found", message, { added: newFranchiseIds.length, already });
  return { status: failed > 0 ? "partial" : "succeeded", message, result: { added: newFranchiseIds.length, already } };
}

export async function runDpdDiscoveryJob(db: AdminClient, job: Job): Promise<JobOutcome> {
  if ((job.payload as { discoverFranchises?: boolean } | null)?.discoverFranchises) return runLoginFranchiseDiscovery(db, job);
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
