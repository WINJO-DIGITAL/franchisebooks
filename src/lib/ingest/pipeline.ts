/**
 * The single import pipeline.
 *
 * Every document — downloaded from the DPD portal, synced from Dropbox or
 * uploaded by hand — goes through `importDocument`, so the same validation,
 * duplicate prevention and review rules apply whatever the source.
 *
 *   bytes → content hash (duplicate?) → store original → extract → parse
 *         → confidence check → match franchise/drivers → transactional store
 *         → anomaly scan → plain-English outcome
 */

import "server-only";
import { sha256Hex } from "@/lib/crypto";
import { loadRoster, type Roster } from "@/lib/data/roster";
import { formatUkDate, formatUkDateTime, type ISODate } from "@/lib/dates";
import { describeError, logger, reportError } from "@/lib/logger";
import { toDb } from "@/lib/money";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";
import { runAnomalyScan } from "@/lib/anomalies/run";
import type { DocumentType } from "./columns";
import { extractDocument } from "./extract";
import { driverKeyFor, matchCategory, matchDriver, matchDriverByVehicle, matchFranchise, stripFdPrefix } from "./match";
import { AUTO_IMPORT_THRESHOLD, parseDocument, PARSER_VERSION, type ParsedDocument, type ParseIssue } from "./parse";

export type ImportSource = "dpd_portal" | "dropbox" | "manual_upload";

export interface ImportInput {
  accountId: string;
  source: ImportSource;
  /** Where the file came from: Dropbox path, portal page, etc. */
  sourceRef?: string | null;
  filename: string;
  mimeType?: string | null;
  bytes: Uint8Array;
  /** Franchise to use when the document itself does not name one. */
  franchiseHintId?: string | null;
  uploadedBy?: string | null;
  importJobId?: string | null;
}

export interface ImportOutcome {
  fileId: string | null;
  status: "imported" | "needs_review" | "failed" | "duplicate";
  documentType: DocumentType;
  /** Plain-English summary for the owner. */
  message: string;
  inserted: number;
  unchanged: number;
  conflicts: number;
  issues: ParseIssue[];
}

const DOCUMENT_LABEL: Record<DocumentType, string> = {
  earnings_report: "earnings report",
  fuel_report: "fuel report",
  expense_report: "expense report",
  unknown: "document",
};

const INTEGRATION: Record<ImportSource, "dpd" | "dropbox" | "upload"> = {
  dpd_portal: "dpd",
  dropbox: "dropbox",
  manual_upload: "upload",
};

function safeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(-80) || "document";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function log(
  db: AdminClient,
  input: { accountId: string; source: ImportSource; importJobId?: string | null },
  level: "info" | "warning" | "error",
  event: string,
  message: string,
  detail: Record<string, unknown> = {},
  franchiseId: string | null = null,
) {
  await db.from("sync_logs").insert({
    account_id: input.accountId,
    integration: INTEGRATION[input.source],
    import_job_id: input.importJobId ?? null,
    franchise_id: franchiseId,
    level,
    event,
    message,
    detail: detail as JsonObject,
  });
}

export async function importDocument(db: AdminClient, input: ImportInput): Promise<ImportOutcome> {
  const sha256 = sha256Hex(input.bytes);
  const base = { inserted: 0, unchanged: 0, conflicts: 0, issues: [] as ParseIssue[] };

  // 1. Duplicate prevention: the same bytes are never imported twice.
  const { data: existing, error: existingError } = await db
    .from("imported_files")
    .select("id, status, original_filename, created_at, document_type")
    .eq("account_id", input.accountId)
    .eq("sha256", sha256)
    .maybeSingle();
  if (existingError) throw new Error(`Could not check for duplicates: ${existingError.message}`);

  let fileId: string;
  if (existing && existing.status !== "failed") {
    const message =
      existing.status === "needs_review"
        ? `"${input.filename}" was already received on ${formatUkDateTime(existing.created_at)} and is waiting for you to check it.`
        : `"${input.filename}" has already been imported (received ${formatUkDateTime(existing.created_at)}). Nothing was changed.`;
    await log(db, input, "info", "duplicate_file", message, { fileId: existing.id, sha256 });
    return { ...base, fileId: existing.id, status: "duplicate", documentType: existing.document_type as DocumentType, message };
  }

  // 2. Keep the original document.
  const storagePath = `${input.accountId}/${new Date().toISOString().slice(0, 7)}/${sha256.slice(0, 16)}-${safeFilename(input.filename)}`;
  const upload = await db.storage.from("source-documents").upload(storagePath, input.bytes, {
    contentType: input.mimeType ?? "application/octet-stream",
    upsert: true,
  });
  if (upload.error) throw new Error(`Could not store the original document: ${upload.error.message}`);

  if (existing) {
    fileId = existing.id;
    await db.from("imported_files").update({ status: "processing", status_message: null, error_detail: null, storage_path: storagePath }).eq("id", fileId);
  } else {
    const { data: created, error: insertError } = await db
      .from("imported_files")
      .insert({
        account_id: input.accountId,
        franchise_id: input.franchiseHintId ?? null,
        source: input.source,
        source_ref: input.sourceRef ?? null,
        original_filename: input.filename,
        mime_type: input.mimeType ?? null,
        byte_size: input.bytes.byteLength,
        sha256,
        storage_path: storagePath,
        status: "processing",
        import_job_id: input.importJobId ?? null,
        uploaded_by: input.uploadedBy ?? null,
      })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        const message = `"${input.filename}" is already being imported.`;
        return { ...base, fileId: null, status: "duplicate", documentType: "unknown", message };
      }
      throw new Error(`Could not record the document: ${insertError.message}`);
    }
    fileId = created.id;
  }

  // 3. Extract, parse, validate and store.
  try {
    return await processFile(db, { ...input, fileId });
  } catch (error) {
    const detail = describeError(error, { step: "process_file" });
    const message = `"${input.filename}" could not be processed. The original has been kept and nothing was imported.`;
    await db.from("imported_files").update({
      status: "failed", status_message: message, error_detail: detail as unknown as JsonObject, processed_at: new Date().toISOString(),
    }).eq("id", fileId);
    await db.from("review_items").insert({
      account_id: input.accountId, imported_file_id: fileId, kind: "extraction_failed",
      title: `"${input.filename}" could not be read`,
      detail: "Something went wrong while reading this document. You can try uploading it again, or enter the figures another way.",
      payload: { error: detail } as unknown as JsonObject,
    });
    await log(db, input, "error", "file_failed", message, { fileId, error: detail });
    await reportError(error, { fileId, step: "process_file" });
    return { ...base, fileId, status: "failed", documentType: "unknown", message };
  }
}

interface ProcessInput extends ImportInput {
  fileId: string;
}

async function processFile(db: AdminClient, input: ProcessInput): Promise<ImportOutcome> {
  const extracted = await extractDocument(input.filename, input.bytes);
  const parsed = parseDocument(extracted);
  const roster = await loadRoster(db, input.accountId);

  // Which franchise? The document's own FD number wins; otherwise the hint (upload choice / folder default).
  const named = matchFranchise(extracted.text, input.filename, roster.franchises);
  const franchiseId = named.franchiseId ?? input.franchiseHintId ?? null;
  if (named.franchiseId && input.franchiseHintId && named.franchiseId !== input.franchiseHintId) {
    parsed.issues.push({ level: "info", message: "The document names a different franchise from the one selected; the franchise named in the document was used." });
  }

  const common = {
    document_type: parsed.documentType,
    parser: PARSER_VERSION,
    parse_confidence: parsed.confidence,
    report_date_from: parsed.dateFrom,
    report_date_to: parsed.dateTo,
    records_found: parsed.earnings.length + parsed.fuel.length + parsed.expenses.length,
    franchise_id: franchiseId,
    processed_at: new Date().toISOString(),
  };
  const label = DOCUMENT_LABEL[parsed.documentType];

  const hold = async (
    kind: "low_confidence" | "unknown_document" | "unmatched_franchise" | "validation_failed",
    title: string,
    detail: string,
  ): Promise<ImportOutcome> => {
    await db.from("imported_files").update({ ...common, status: "needs_review", status_message: detail }).eq("id", input.fileId);
    await db.from("review_items").insert({
      account_id: input.accountId,
      franchise_id: franchiseId,
      imported_file_id: input.fileId,
      kind,
      title,
      detail,
      payload: { parsed, franchiseId, filename: input.filename } as unknown as JsonObject,
      dedupe_key: `file:${input.fileId}:${kind}`,
    });
    await log(db, input, "warning", "file_needs_review", `${title}. ${detail}`, { fileId: input.fileId, confidence: parsed.confidence, issues: parsed.issues.slice(0, 20) }, franchiseId);
    return { fileId: input.fileId, status: "needs_review", documentType: parsed.documentType, message: `${title}. ${detail}`, inserted: 0, unchanged: 0, conflicts: 0, issues: parsed.issues };
  };

  if (parsed.documentType !== "unknown" && parsed.emptyReport) {
    // A report with headings and no rows is a day with nothing in it. Record it as read, so it is not read again as new
    // and does not wait for anyone to decide anything.
    const dateText = parsed.dateFrom ? ` for ${formatUkDate(parsed.dateFrom)}` : "";
    const message = `${label[0]!.toUpperCase()}${label.slice(1)}${dateText}: nothing reported for this day.`;
    await db.from("imported_files").update({ ...common, status: "imported", status_message: message, records_imported: 0, records_unchanged: 0 }).eq("id", input.fileId);
    await log(db, input, "info", "file_imported", message, { fileId: input.fileId, empty: true }, franchiseId);
    return { fileId: input.fileId, status: "imported", documentType: parsed.documentType, message, inserted: 0, unchanged: 0, conflicts: 0, issues: parsed.issues };
  }
  if (parsed.documentType === "unknown" || common.records_found === 0) {
    const reason = parsed.issues.find((i) => i.level === "error")?.message ?? "It does not look like an earnings, fuel or expense report.";
    return hold("unknown_document", `"${input.filename}" was not recognised`, `${reason} Nothing was imported.`);
  }
  if (parsed.confidence < AUTO_IMPORT_THRESHOLD) {
    const problems = parsed.issues.filter((i) => i.level !== "info").length;
    return hold(
      "low_confidence",
      `"${input.filename}" needs checking before it is imported`,
      `This ${label} could not be read with enough certainty (${plural(problems, "problem")} found), so nothing has been imported yet. Check the figures against the original and approve or reject them.`,
    );
  }
  if (parsed.documentType === "earnings_report" && !franchiseId) {
    return hold(
      "unmatched_franchise",
      `"${input.filename}" could not be matched to a franchise`,
      named.ambiguous
        ? "The document mentions more than one of your FD numbers. Choose the franchise it belongs to."
        : "None of your FD numbers appear in the document. Choose the franchise it belongs to, or add the franchise in Settings first.",
    );
  }

  const stored = await storeParsed(db, { accountId: input.accountId, fileId: input.fileId, franchiseId, parsed, roster });
  const status = stored.conflicts > 0 ? "needs_review" : "imported";
  const dateText = parsed.dateFrom
    ? parsed.dateFrom === parsed.dateTo ? ` for ${formatUkDate(parsed.dateFrom)}` : ` for ${formatUkDate(parsed.dateFrom)} to ${formatUkDate(parsed.dateTo)}`
    : "";
  const parts: string[] = [];
  if (stored.inserted > 0) parts.push(`${plural(stored.inserted, parsed.documentType === "earnings_report" ? "driver record" : "record")} imported`);
  if (stored.unchanged > 0) parts.push(`${stored.unchanged} already up to date`);
  if (stored.conflicts > 0) parts.push(`${plural(stored.conflicts, "record")} disagree with figures already stored and need checking`);
  if (stored.unmatchedDrivers > 0) parts.push(`${plural(stored.unmatchedDrivers, "name")} not matched to a registered driver`);
  if (stored.unallocated > 0) parts.push(`${stored.unallocated} could not be matched to a driver`);
  const message = `${label[0]!.toUpperCase()}${label.slice(1)}${dateText}: ${parts.join(", ") || "nothing new"}.`;

  await db.from("imported_files").update({
    ...common, status, status_message: message, records_imported: stored.inserted, records_unchanged: stored.unchanged,
  }).eq("id", input.fileId);
  await log(db, input, stored.conflicts > 0 ? "warning" : "info", "file_imported", message, { fileId: input.fileId, ...stored }, franchiseId);

  if (parsed.dateFrom && parsed.dateTo) {
    try {
      await runAnomalyScan(db, input.accountId, { from: parsed.dateFrom, to: parsed.dateTo });
    } catch (error) {
      logger.warn({ err: describeError(error) }, "Anomaly scan after import failed");
    }
  }
  return { fileId: input.fileId, status, documentType: parsed.documentType, message, inserted: stored.inserted, unchanged: stored.unchanged, conflicts: stored.conflicts, issues: parsed.issues };
}

interface StoreInput {
  accountId: string;
  fileId: string;
  franchiseId: string | null;
  parsed: ParsedDocument;
  roster: Roster;
}

interface StoreResult {
  inserted: number;
  unchanged: number;
  conflicts: number;
  unmatchedDrivers: number;
  unallocated: number;
}

/**
 * Adds a driver found on a DPD report: a new driver record, linked to the franchise they drove for from that date, and
 * remembered in the roster so later rows (and later files) match them. Used for drivers DPD names but the account has not
 * registered yet.
 */
async function addDriverFromReport(
  db: AdminClient,
  accountId: string,
  roster: Roster,
  row: { franchiseId: string; name: string; ref: string | null; date: ISODate },
): Promise<string> {
  // DPD sometimes puts the franchise number in front of the name ("FD42102 Jane Smith"); the name is the driver.
  const name = stripFdPrefix(row.name).trim() || "Unnamed driver";
  const ref = row.ref?.trim() ? row.ref.trim().toUpperCase() : null;
  const { data: created, error } = await db.from("drivers").insert({ account_id: accountId, display_name: name.slice(0, 120), dpd_driver_ref: ref }).select("id").single();
  if (error || !created) throw new Error(`Could not add driver ${name}: ${error?.message ?? "no id returned"}`);
  const { error: assignError } = await db.from("driver_assignments").insert({ account_id: accountId, driver_id: created.id, franchise_id: row.franchiseId, start_date: row.date });
  if (assignError) throw new Error(`Could not link driver ${name} to the franchise: ${assignError.message}`);
  roster.drivers.push({
    id: created.id,
    displayName: name,
    dpdRef: ref,
    aliases: [],
    assignments: [{ franchiseId: row.franchiseId, startDate: row.date, endDate: null, vehicleRegistration: null }],
  });
  return created.id;
}

/** Matches parsed rows to drivers and writes them through the transactional ingest functions. */
export async function storeParsed(db: AdminClient, input: StoreInput): Promise<StoreResult> {
  const { parsed, roster, franchiseId } = input;
  const result: StoreResult = { inserted: 0, unchanged: 0, conflicts: 0, unmatchedDrivers: 0, unallocated: 0 };
  const apply = (data: unknown) => {
    const counts = data as { inserted: number; unchanged: number; conflicts: number };
    result.inserted += counts.inserted;
    result.unchanged += counts.unchanged;
    result.conflicts += counts.conflicts;
  };

  if (parsed.documentType === "earnings_report") {
    if (!franchiseId) throw new Error("An earnings report cannot be stored without a franchise");
    const unmatched = new Set<string>();
    // Drivers named on a DPD report are added automatically the first time they appear, so nobody has to register them by hand.
    const addedThisFile = new Map<string, string>();
    const rows = [];
    for (const row of parsed.earnings) {
      const match = matchDriver({ ref: row.driverRef, name: row.driverName, franchiseId, date: row.date }, roster.drivers);
      const driverKey = driverKeyFor(row.driverRef, row.driverName);
      let driverId = match.driverId;
      if (!driverId && !match.ambiguous) {
        driverId = addedThisFile.get(driverKey) ?? (await addDriverFromReport(db, input.accountId, roster, { franchiseId, name: row.driverName, ref: row.driverRef, date: row.date }));
        addedThisFile.set(driverKey, driverId);
      }
      if (!driverId) unmatched.add(driverKey);
      rows.push({
        franchise_id: franchiseId,
        driver_id: driverId ?? "",
        source_driver_name: row.driverName,
        source_driver_ref: row.driverRef ?? "",
        driver_key: driverKey,
        report_date: row.date,
        route: row.route ?? "",
        parcels: row.parcels == null ? "" : String(row.parcels),
        stops: row.stops == null ? "" : String(row.stops),
        pay_per_parcel: row.payPerParcel ?? "",
        pay_per_stop: row.payPerStop ?? "",
        excess_parcels: row.excessParcels == null ? "" : String(row.excessParcels),
        mileage: row.mileage == null ? "" : String(row.mileage),
        stop_pay: row.stopPay == null ? "" : toDb(row.stopPay),
        parcel_pay: row.parcelPay == null ? "" : toDb(row.parcelPay),
        gross_earnings: toDb(row.gross),
        deductions: toDb(row.deductions),
        additional_payments: toDb(row.additional),
        net_earnings: row.net == null ? "" : toDb(row.net),
        confidence: String(parsed.confidence),
      });
    }
    const { data, error } = await db.rpc("ingest_earnings", { p_file_id: input.fileId, p_rows: rows as unknown as JsonObject });
    if (error) throw new Error(`Storing earnings failed: ${error.message}`);
    apply(data);
    result.unmatchedDrivers = unmatched.size;
  }

  if (parsed.documentType === "fuel_report") {
    const occurrences = new Map<string, number>();
    const rows = parsed.fuel.map((row) => {
      const byVehicle = matchDriverByVehicle(row.registration, row.date, roster.drivers);
      const byName = byVehicle.driverId ? null : matchDriver({ ref: null, name: row.driverName, franchiseId, date: row.date }, roster.drivers);
      const driverId = byVehicle.driverId ?? byName?.driverId ?? null;
      if (!driverId) result.unallocated += 1;
      const rowFranchise = franchiseId ?? soleFranchiseOf(roster, driverId, row.date);
      const identity = row.reference
        ? `ref|${row.reference.toLowerCase()}|${row.date}`
        : sha256Hex([row.date, row.time ?? "", row.registration ?? "", row.cardReference ?? "", row.litres ?? "", row.total, row.supplier ?? ""].join("|")).slice(0, 32);
      const n = (occurrences.get(identity) ?? 0) + 1;
      occurrences.set(identity, n);
      return {
        franchise_id: rowFranchise ?? "",
        transaction_date: row.date,
        transaction_time: row.time ?? "",
        description: row.description ?? "",
        supplier: row.supplier ?? "",
        vehicle_registration: row.registration ?? "",
        source_driver_name: row.driverName ?? "",
        card_reference: row.cardReference ?? "",
        litres: row.litres ?? "",
        price_per_litre: row.pricePerLitre ?? "",
        total_cost: toDb(row.total),
        transaction_ref: row.reference ?? "",
        dedupe_key: `fuel|${identity}|${n}`,
        driver_id: driverId ?? "",
        allocation_method: byVehicle.driverId ? "auto_vehicle" : "auto_driver_ref",
        allocation_note: byVehicle.driverId
          ? `Vehicle ${row.registration} was assigned to this driver on ${formatUkDate(row.date)}`
          : driverId ? "Driver named on the fuel report" : "",
      };
    });
    const { data, error } = await db.rpc("ingest_fuel", { p_file_id: input.fileId, p_rows: rows as unknown as JsonObject });
    if (error) throw new Error(`Storing fuel transactions failed: ${error.message}`);
    apply(data);
  }

  if (parsed.documentType === "expense_report") {
    const occurrences = new Map<string, number>();
    const rows = parsed.expenses.map((row) => {
      const category = matchCategory(row.categoryText, row.description, roster.categories);
      if (!category) throw new Error("No expense category is available to file this expense under");
      const byVehicle = matchDriverByVehicle(row.registration, row.date, roster.drivers);
      const byName = byVehicle.driverId ? null : matchDriver({ ref: null, name: row.driverName, franchiseId, date: row.date }, roster.drivers);
      const driverId = byVehicle.driverId ?? byName?.driverId ?? null;
      if (!driverId) result.unallocated += 1;
      const rowFranchise = franchiseId ?? soleFranchiseOf(roster, driverId, row.date) ?? "";
      // The franchise is part of the identity: two franchises can be charged the same amount for the same thing on the same day.
      const identity = row.reference
        ? `ref|${row.reference.toLowerCase()}|${row.date}|${row.amount}|${rowFranchise}`
        : sha256Hex([rowFranchise, row.date, row.amount, row.supplier ?? "", row.description, row.registration ?? ""].join("|")).slice(0, 32);
      const n = (occurrences.get(identity) ?? 0) + 1;
      occurrences.set(identity, n);
      return {
        franchise_id: rowFranchise,
        category_id: category.id,
        expense_date: row.date,
        description: row.description,
        supplier: row.supplier ?? "",
        vehicle_registration: row.registration ?? "",
        source_driver_name: row.driverName ?? "",
        amount: toDb(row.amount),
        transaction_ref: row.reference ?? "",
        dedupe_key: `exp|${identity}|${n}`,
        driver_id: driverId ?? "",
        allocation_method: byVehicle.driverId ? "auto_vehicle" : "auto_driver_ref",
        allocation_note: byVehicle.driverId
          ? `Vehicle ${row.registration} was assigned to this driver on ${formatUkDate(row.date)}`
          : driverId ? "Driver named on the expense report" : "",
      };
    });
    const { data, error } = await db.rpc("ingest_expenses", { p_file_id: input.fileId, p_rows: rows as unknown as JsonObject });
    if (error) throw new Error(`Storing expenses failed: ${error.message}`);
    apply(data);
  }
  return result;
}

/** The franchise a driver worked for on a date, when there is exactly one. */
function soleFranchiseOf(roster: Roster, driverId: string | null, date: ISODate): string | null {
  if (!driverId) return null;
  const driver = roster.drivers.find((d) => d.id === driverId);
  const ids = new Set(
    (driver?.assignments ?? []).filter((a) => a.startDate <= date && (a.endDate == null || a.endDate >= date)).map((a) => a.franchiseId),
  );
  return ids.size === 1 ? [...ids][0]! : null;
}

/**
 * Owner decision on a held document: approve (store the rows exactly as
 * shown to them) or reject (store nothing). Conflict items are resolved
 * through the resolve_earnings_conflict database function instead.
 */
export async function decideReviewItem(
  db: AdminClient,
  input: { accountId: string; reviewItemId: string; userId: string; decision: "accept" | "reject"; franchiseId?: string | null; note?: string | null },
): Promise<{ message: string }> {
  const { data: item, error } = await db
    .from("review_items")
    .select("id, kind, status, payload, imported_file_id, franchise_id")
    .eq("id", input.reviewItemId)
    .eq("account_id", input.accountId)
    .maybeSingle();
  if (error || !item) throw new Error("That item could not be found.");
  if (item.status !== "open") throw new Error("That item has already been dealt with.");
  if (item.kind === "source_conflict") throw new Error("Conflicts are resolved by choosing which figures to keep.");

  const resolve = async (status: "accepted" | "rejected", fileStatus: "imported" | "ignored", message: string, counts?: StoreResult) => {
    await db.from("review_items").update({
      status, resolved_by: input.userId, resolved_at: new Date().toISOString(), resolution_note: input.note ?? null,
    }).eq("id", item.id);
    if (item.imported_file_id) {
      await db.from("imported_files").update({
        status: fileStatus, status_message: message,
        ...(counts ? { records_imported: counts.inserted, records_unchanged: counts.unchanged } : {}),
        ...(input.franchiseId ? { franchise_id: input.franchiseId } : {}),
      }).eq("id", item.imported_file_id);
    }
    return { message };
  };

  if (input.decision === "reject") {
    return resolve("rejected", "ignored", "Rejected. Nothing from this document was imported.");
  }
  if (item.kind === "unknown_document" || item.kind === "extraction_failed" || !item.imported_file_id) {
    throw new Error("This document could not be read, so there is nothing to approve. Reject it, or upload a readable copy.");
  }

  const payload = item.payload as unknown as { parsed: ParsedDocument; franchiseId: string | null };
  const franchiseId = input.franchiseId ?? payload.franchiseId ?? item.franchise_id;
  if (payload.parsed.documentType === "earnings_report" && !franchiseId) {
    throw new Error("Choose which franchise this document belongs to.");
  }
  const roster = await loadRoster(db, input.accountId);
  if (franchiseId && !roster.franchises.some((f) => f.id === franchiseId)) throw new Error("Franchise not found.");

  const stored = await storeParsed(db, { accountId: input.accountId, fileId: item.imported_file_id, franchiseId: franchiseId ?? null, parsed: payload.parsed, roster });
  const message = `Approved: ${plural(stored.inserted, "record")} imported${stored.unchanged ? `, ${stored.unchanged} already up to date` : ""}${stored.conflicts ? `, ${plural(stored.conflicts, "record")} need checking` : ""}.`;
  const outcome = await resolve("accepted", stored.conflicts > 0 ? "imported" : "imported", message, stored);
  if (stored.conflicts > 0) {
    await db.from("imported_files").update({ status: "needs_review" }).eq("id", item.imported_file_id);
  }
  if (payload.parsed.dateFrom && payload.parsed.dateTo) {
    await runAnomalyScan(db, input.accountId, { from: payload.parsed.dateFrom, to: payload.parsed.dateTo }).catch(() => undefined);
  }
  await db.from("sync_logs").insert({
    account_id: input.accountId, integration: "upload", franchise_id: franchiseId ?? null, level: "info", event: "review_accepted", message,
    detail: { reviewItemId: item.id, fileId: item.imported_file_id } as JsonObject,
  });
  return outcome;
}
