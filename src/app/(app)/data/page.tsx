import type { Metadata } from "next";
import Link from "next/link";
import {
  AddFolderDialog, ConflictActions, DisconnectDropboxButton, ExplorePortalButton, PortalMapForm, RemoveFolderButton, ReviewActions, SyncDropboxButton, UploadArea,
} from "@/components/data/panels";
import { SyncButtons } from "@/components/sync-buttons";
import { Badge, EmptyState, Notice, PageHeader, Panel, Section, TableWrap } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import { franchiseLabel, getContext } from "@/lib/context";
import { loadSyncOverview } from "@/lib/data/status";
import { formatRelative, formatUkDate, formatUkDateTime } from "@/lib/dates";
import { dpdSetupReady, ownPortalMap } from "@/lib/dpd/readiness";
import { env } from "@/lib/env";
import { DOCUMENT_TYPE, FILE_STATUS } from "@/lib/labels";
import { formatGBP, fromDb } from "@/lib/money";

export const metadata: Metadata = { title: "Data & Integrations" };

const DROPBOX_MESSAGES: Record<string, { tone: "good" | "warn" | "bad"; text: string }> = {
  connected: { tone: "good", text: "Dropbox connected. Choose the folders you want watched below." },
  cancelled: { tone: "warn", text: "Dropbox connection was cancelled. Nothing was changed." },
  invalid: { tone: "bad", text: "That Dropbox connection attempt could not be verified. Please try again." },
  error: { tone: "bad", text: "Dropbox could not be connected. Please try again in a moment." },
  not_configured: { tone: "warn", text: "Dropbox has not been set up for this app yet. See the Dropbox setup steps in the deployment guide." },
  forbidden: { tone: "bad", text: "Only the owner can connect Dropbox." },
};

export default async function DataPage({ searchParams }: { searchParams: Promise<{ dropbox?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const { supabase, accountId } = ctx;
  const sync = await loadSyncOverview(supabase, accountId);
  const franchises = ctx.franchises.filter((f) => f.isActive).map((f) => ({ id: f.id, label: franchiseLabel(f) }));

  const [files, reviews, folders, jobs, logs, connections, discovery] = await Promise.all([
    supabase.from("imported_files").select("id, original_filename, source, document_type, status, status_message, report_date_from, report_date_to, records_imported, records_unchanged, created_at, franchise_id").order("created_at", { ascending: false }).limit(25),
    supabase.from("review_items").select("id, kind, title, detail, payload, imported_file_id, franchise_id, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(50),
    supabase.from("integration_folders").select("id, path_display, default_franchise_id, last_checked_at"),
    supabase.from("import_jobs").select("id, job_type, status, trigger, report_date, error_message, finished_at, created_at, franchise_id").order("created_at", { ascending: false }).limit(10),
    supabase.from("sync_logs").select("id, integration, level, message, created_at, detail").order("created_at", { ascending: false }).limit(15),
    supabase.from("integration_connections").select("provider, status, display_name, config").eq("account_id", accountId),
    supabase.from("import_jobs").select("id, status, result, finished_at").eq("job_type", "dpd_discovery").order("created_at", { ascending: false }).limit(1),
  ]);
  // Owners only (the table itself also only lets owners read it).
  const unreadable = ctx.isOwner
    ? (await supabase.from("unreadable_documents").select("id, franchise_id, document_no, reason, pdf_path, first_seen_at, last_seen_at").is("resolved_at", null).order("last_seen_at", { ascending: false }).limit(50)).data ?? []
    : [];
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const dropbox = connections.data?.find((c) => c.provider === "dropbox");
  const dpd = connections.data?.find((c) => c.provider === "dpd");
  const dropboxConfigured = Boolean(env.dropbox());
  const dropboxConnected = Boolean(dropbox && dropbox.status !== "disconnected");
  const flash = params.dropbox ? DROPBOX_MESSAGES[params.dropbox] : null;
  const reviewList = reviews.data ?? [];
  const fileList = files.data ?? [];
  const attention = reviewList.length;
  const importedToday = fileList.filter((f) => f.status === "imported").length;
  const inventory = (discovery.data?.[0]?.result as { markdown?: string; message?: string } | null) ?? null;
  const portalMap = ownPortalMap(dpd?.config);

  return (
    <>
      <PageHeader title="Data & Integrations" description="Where your information comes from, and anything that needs checking." />
      {flash ? <Notice tone={flash.tone} className="mb-6">{flash.text}</Notice> : null}

      {/* Status */}
      <Section title="Status">
        <div className="grid gap-3 md:grid-cols-2">
          {[sync.dpd, sync.dropbox].map((s) => (
            <Notice key={s.key} tone={s.tone} title={s.headline}>
              {s.detail}
              {s.lastSuccessAt ? <span className="mt-1 block text-sm text-muted">Last successful sync: {formatUkDateTime(s.lastSuccessAt)}</span> : null}
            </Notice>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted">
          {fileList.length} recent document{fileList.length === 1 ? "" : "s"} · {importedToday} imported · {attention} need{attention === 1 ? "s" : ""} attention · {sync.failedFiles} failed
          {sync.lastImportAt ? ` · last document ${formatRelative(sync.lastImportAt)}` : ""}
        </p>
        {ctx.canWrite ? <div className="mt-3"><SyncButtons dpdRunning={sync.dpd.running} dropboxRunning={sync.dropbox.running} dropboxConnected={dropboxConnected} /></div> : null}
      </Section>

      {/* Needs attention */}
      <Section id="attention" title={attention ? `Needs attention (${attention})` : "Needs attention"} description="Nothing here has been imported or changed until you decide.">
        {reviewList.length === 0 ? (
          <Panel className="text-[0.9375rem] text-muted">Nothing needs checking. Everything that arrived has been imported.</Panel>
        ) : (
          <ul className="space-y-3">
            {reviewList.map((item) => {
              const payload = item.payload as { existing?: { original_earnings?: number; gross_earnings?: number; stops?: number; parcels?: number }; incoming?: { gross_earnings?: string; stops?: string; parcels?: string; net_earnings?: string } };
              return (
                <li key={item.id}>
                  <Panel>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={item.kind === "source_conflict" ? "bad" : "warn"}>
                        {item.kind === "source_conflict" ? "Documents disagree" : item.kind === "low_confidence" ? "Needs checking" : item.kind === "unmatched_franchise" ? "Which franchise?" : item.kind === "unknown_document" ? "Not recognised" : "Could not be read"}
                      </Badge>
                      <span className="text-sm text-muted">{formatUkDateTime(item.created_at)}</span>
                    </div>
                    <h3 className="mt-2 font-semibold">{item.title}</h3>
                    <p className="mt-1 text-[0.9375rem] text-ink-soft">{item.detail}</p>
                    {item.kind === "source_conflict" && payload.existing && payload.incoming ? (
                      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                        <div className="rounded-lg bg-sunken p-3"><p className="font-medium">Already stored</p><p className="num mt-1">Earnings {formatGBP(fromDb(payload.existing.original_earnings))} · {payload.existing.stops ?? "—"} stops · {payload.existing.parcels ?? "—"} parcels</p></div>
                        <div className="rounded-lg bg-sunken p-3"><p className="font-medium">New document says</p><p className="num mt-1">Earnings {formatGBP(fromDb(payload.incoming.net_earnings || payload.incoming.gross_earnings))} · {payload.incoming.stops || "—"} stops · {payload.incoming.parcels || "—"} parcels</p></div>
                      </div>
                    ) : null}
                    {item.imported_file_id ? <p className="mt-2 text-sm"><a className="text-accent hover:underline" href={`/api/files/${item.imported_file_id}`}>Open the original document</a></p> : null}
                    {ctx.canWrite ? (
                      item.kind === "source_conflict" ? <ConflictActions id={item.id} /> : (
                        <ReviewActions id={item.id} needsFranchise={item.kind === "unmatched_franchise"} franchises={franchises} canApprove={item.kind === "low_confidence" || item.kind === "unmatched_franchise"} />
                      )
                    ) : null}
                  </Panel>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* DPD documents that could not be read: owner only */}
      {ctx.isOwner && unreadable.length > 0 ? (
        <Section id="unreadable" title={`Documents That Could Not Be Read (${unreadable.length})`} description="DPD documents the nightly sync downloaded but could not read, or invoices whose lines don't add up to their own total. Nothing that can't be trusted has been counted. Open the original to check it; the sync reads it again each night.">
          <TableWrap>
            <table className="ledger" data-testid="unreadable-documents">
              <thead><tr><th>Franchise</th><th>Document</th><th className="hidden sm:table-cell">First Seen</th><th>Why</th><th className="r"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {unreadable.map((d) => (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap">{franchiseName.get(d.franchise_id) ?? "—"}</td>
                    <td className="num whitespace-nowrap">{d.document_no}<span className="block text-xs text-ink-soft sm:hidden">{formatUkDate(d.first_seen_at.slice(0, 10))}</span></td>
                    <td className="hidden whitespace-nowrap sm:table-cell">{formatUkDateTime(d.first_seen_at)}</td>
                    <td className="text-sm text-ink-soft">{unreadableReason(d.reason)}</td>
                    <td className="r whitespace-nowrap">
                      {d.pdf_path ? (
                        <span className="inline-flex gap-2">
                          <a className={buttonClass("secondary", "sm")} href={`/api/unreadable-documents/${d.id}`} target="_blank" rel="noopener">View</a>
                          <a className={buttonClass("quiet", "sm")} href={`/api/unreadable-documents/${d.id}?download=1`}>Download</a>
                        </span>
                      ) : <span className="text-sm text-muted">Kept on the next sync</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Section>
      ) : null}

      {/* Upload */}
      {ctx.canWrite ? (
        <Section title="Upload Documents" description="If automatic sync is not working, drop in an earnings PDF, fuel report or expense spreadsheet. The same checks apply as for automatic imports.">
          <UploadArea franchises={franchises} defaultFranchiseId={ctx.franchiseId} />
        </Section>
      ) : null}

      {/* Dropbox */}
      <Section title="Dropbox" description="Watch folders for new earnings, fuel and expense documents.">
        <Panel>
          {!dropboxConnected ? (
            <div className="flex flex-wrap items-center gap-4">
              <p className="min-w-60 flex-1 text-[0.9375rem] text-ink-soft">{dropboxConfigured ? "Connect your Dropbox so new documents are imported automatically." : "Dropbox has not been set up for this app yet. Add the Dropbox app key and secret first (see the deployment guide)."}</p>
              {ctx.isOwner ? <a href="/api/dropbox/connect" className={buttonClass("primary", "md", !dropboxConfigured ? "pointer-events-none opacity-50" : undefined)} aria-disabled={!dropboxConfigured}>Connect Dropbox</a> : null}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{dropbox?.display_name ?? "Dropbox"}</p>
                  <p className="text-sm text-muted">{sync.dropbox.headline} {sync.dropbox.detail}</p>
                </div>
                {ctx.isOwner ? (
                  <div className="flex flex-wrap gap-2">
                    {dropbox?.status === "needs_reconnect" ? <a href="/api/dropbox/connect" className={buttonClass("primary")}>Reconnect Dropbox</a> : null}
                    <SyncDropboxButton />
                    <DisconnectDropboxButton />
                  </div>
                ) : null}
              </div>
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="mb-2 text-sm font-semibold">Folders Being Watched</h3>
                {(folders.data ?? []).length === 0 ? <p className="text-sm text-muted">No folders chosen yet.</p> : (
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {(folders.data ?? []).map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                        <div><p className="font-medium">{f.path_display}</p><p className="text-sm text-muted">{f.default_franchise_id ? franchiseName.get(f.default_franchise_id) : "Franchise worked out from each document"} · checked {formatRelative(f.last_checked_at)}</p></div>
                        {ctx.isOwner ? <RemoveFolderButton id={f.id} /> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {ctx.isOwner ? <div className="mt-3"><AddFolderDialog franchises={franchises} /></div> : null}
              </div>
            </>
          )}
        </Panel>
      </Section>

      {/* Recent documents */}
      <Section title="Recent Documents">
        {fileList.length === 0 ? <EmptyState title="No Documents Yet">Documents appear here as they arrive from DPD, Dropbox or an upload.</EmptyState> : (
          <TableWrap>
            <table className="ledger">
              <thead><tr><th>Document</th><th>Kind</th><th>Covers</th><th>Result</th><th>Received</th></tr></thead>
              <tbody>
                {fileList.map((f) => (
                  <tr key={f.id}>
                    <td className="max-w-xs"><a className="break-words font-medium hover:underline" href={`/api/files/${f.id}`}>{f.original_filename}</a><span className="block text-xs text-muted">{f.source === "dpd_portal" ? "DPD portal" : f.source === "dropbox" ? "Dropbox" : "Uploaded by hand"}{f.franchise_id ? ` · ${franchiseName.get(f.franchise_id) ?? ""}` : ""}</span></td>
                    <td>{DOCUMENT_TYPE[f.document_type] ?? f.document_type}</td>
                    <td className="num whitespace-nowrap text-sm">{f.report_date_from ? (f.report_date_from === f.report_date_to || !f.report_date_to ? formatUkDate(f.report_date_from) : `${formatUkDate(f.report_date_from)} – ${formatUkDate(f.report_date_to)}`): "—"}</td>
                    <td className="max-w-sm"><Badge tone={FILE_STATUS[f.status]?.tone ?? "neutral"}>{FILE_STATUS[f.status]?.label ?? f.status}</Badge>{f.status_message ? <span className="mt-1 block text-sm text-muted">{f.status_message}</span> : null}</td>
                    <td className="whitespace-nowrap text-sm text-muted">{formatUkDateTime(f.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      {/* DPD portal */}
      <Section title="DPD Portal" description="Read-only access to the DPD partner portal. It can only look and download; it can never change anything in DPD.">
        <Panel>
          <p className="text-[0.9375rem] text-ink-soft">
            {dpdSetupReady(dpd?.config) ? "Your DPD login is saved. Automatic DPD sync runs every evening at the time set in Settings." : "Automatic DPD sync is not set up yet. Add your DPD login in Settings and it runs every evening."}
          </p>
          {ctx.isOwner ? (
            <div className="mt-4 space-y-5">
              <ExplorePortalButton />
              {inventory?.markdown ? (
                <details className="rounded-lg border border-line bg-surface px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium">Result of the last exploration ({formatRelative(discovery.data?.[0]?.finished_at)})</summary>
                  <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs">{inventory.markdown}</pre>
                </details>
              ) : null}
              <details className="rounded-lg border border-line bg-surface px-4 py-3">
                <summary className="cursor-pointer text-sm font-medium">Custom Portal Setup for This Account (Advanced; Normally Left Empty)</summary>
                <div className="mt-3"><PortalMapForm current={portalMap ? JSON.stringify(portalMap, null, 2) : ""} /></div>
              </details>
            </div>
          ) : null}
        </Panel>
      </Section>

      {/* Activity */}
      <Section title="Recent Activity">
        {(logs.data ?? []).length === 0 ? <p className="text-sm text-muted">Nothing has happened yet.</p> : (
          <Panel flush>
            <ul className="divide-y divide-line">
              {(logs.data ?? []).map((log) => (
                <li key={log.id} className="flex gap-3 px-4 py-3 text-[0.9375rem]">
                  <Badge tone={log.level === "error" ? "bad" : log.level === "warning" ? "warn" : "neutral"} className="mt-0.5 shrink-0">{log.integration === "dpd" ? "DPD" : log.integration === "dropbox" ? "Dropbox" : log.integration === "upload" ? "Upload" : "System"}</Badge>
                  <div className="min-w-0 flex-1">
                    <p>{log.message}</p>
                    <p className="text-xs text-muted">{formatUkDateTime(log.created_at)}</p>
                    {log.level !== "info" && log.detail ? <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Technical Details</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono">{JSON.stringify(log.detail, null, 2).slice(0, 1500)}</pre></details> : null}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {(jobs.data ?? []).some((j) => j.status === "failed" || j.status === "blocked") ? (
          <p className="mt-3 text-sm text-muted">Jobs that failed or were blocked appear above with an explanation. <Link href="/data#attention" className="text-accent hover:underline">Back to items needing attention</Link></p>
        ) : null}
      </Section>
    </>
  );
}

/** The reason in short: the part of the sync's message in brackets ("no billing period found"), or the message itself. */
function unreadableReason(message: string): string {
  // A stored invoice whose lines do not add up: say so, then what was wrong.
  const addUp = /lines do not add up to its own total[^:]*:\s*(.*)$/s.exec(message);
  if (addUp) return `Lines don't add up to the invoice's own total. ${addUp[1]}`.trim();
  const inBrackets = /\(([^)]+)\)/.exec(message)?.[1];
  const text = inBrackets ?? message;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
