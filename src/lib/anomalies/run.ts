/**
 * Runs anomaly detection against stored data and records new alerts.
 * Existing alerts keep whatever status the owner gave them; alerts about
 * missing information close themselves when the information arrives.
 */

import "server-only";
import { fetchAll, must } from "@/lib/data/fetch-all";
import { loadCosts, loadCovers, loadEarnings } from "@/lib/data/period";
import { addDays, londonMinutesOfDay, londonToday, parseTimeToMinutes, type ISODate } from "@/lib/dates";
import type { AdminClient } from "@/lib/supabase/admin";
import type { JsonObject } from "@/lib/supabase/json";
import { detectAnomalies, resolveAnomalyConfig, type AnomalyCandidate } from "./detect";

const HISTORY_DAYS = 120;
/** Reports are treated as due this long after the scheduled sync time. */
const REPORT_GRACE_MINUTES = 90;

export interface ScanResult {
  detected: number;
  created: number;
  autoResolved: number;
}

export async function runAnomalyScan(
  db: AdminClient,
  accountId: string,
  range: { from: ISODate; to: ISODate },
  now: Date = new Date(),
): Promise<ScanResult> {
  const historyFrom = addDays(range.from, -HISTORY_DAYS);
  const filter = { accountId, from: historyFrom, to: range.to };

  const [settings, franchises, drivers, assignments, earnings, costs, covers, conflicts] = await Promise.all([
    db.from("app_settings").select("anomaly_config, sync_time_local, sync_timezone").eq("account_id", accountId).maybeSingle().then((r) => must(r, "Loading settings")),
    fetchAll(() => db.from("franchises").select("id, fd_number, name, is_active").eq("account_id", accountId).order("id")),
    fetchAll(() => db.from("drivers").select("id, display_name, is_active, start_date, leaving_date").eq("account_id", accountId).order("id")),
    fetchAll(() => db.from("driver_assignments").select("id, driver_id, franchise_id, start_date, end_date").eq("account_id", accountId).order("id")),
    loadEarnings(db, filter),
    loadCosts(db, filter),
    loadCovers(db, filter),
    fetchAll(() => db.from("review_items").select("id, franchise_id, title, detail, payload, created_at").eq("account_id", accountId).eq("kind", "source_conflict").eq("status", "open").order("id")),
  ]);

  const timezone = settings?.sync_timezone ?? "Europe/London";
  const today = londonToday(now, timezone);
  const syncMinutes = parseTimeToMinutes(settings?.sync_time_local ?? "20:30") ?? 20 * 60 + 30;
  const reportsExpectedThrough = londonMinutesOfDay(now, timezone) >= syncMinutes + REPORT_GRACE_MINUTES ? today : addDays(today, -1);

  const candidates = detectAnomalies({
    evalFrom: range.from,
    evalTo: range.to,
    reportsExpectedThrough,
    config: resolveAnomalyConfig(settings?.anomaly_config),
    franchises: franchises.filter((f) => f.is_active).map((f) => ({ id: f.id, fdNumber: f.fd_number, name: f.name })),
    drivers: drivers.map((d) => ({ id: d.id, name: d.display_name, isActive: d.is_active, startDate: d.start_date, leavingDate: d.leaving_date })),
    assignments: assignments.map((a) => ({ driverId: a.driver_id, franchiseId: a.franchise_id, startDate: a.start_date, endDate: a.end_date })),
    earnings,
    costs: costs.map((c) => ({
      id: c.id, kind: c.kind, isFuel: c.kind === "fuel" || c.categoryKind === "fuel", franchiseId: c.franchiseId,
      driverId: c.allocation.scope === "driver" ? c.allocation.driverId : null, date: c.date, amount: c.amount,
      categoryId: c.categoryId, categoryName: c.categoryName, supplier: c.supplier, vehicleRegistration: c.vehicleRegistration, reference: c.reference,
    })),
    covers,
    openConflicts: conflicts.map((c) => {
      const incoming = (c.payload as { incoming?: { report_date?: string } } | null)?.incoming;
      return { id: c.id, franchiseId: c.franchise_id, title: c.title, detail: c.detail, date: incoming?.report_date ?? c.created_at.slice(0, 10) };
    }),
  });

  const created = await saveCandidates(db, accountId, candidates);
  const autoResolved = await closeStaleAlerts(db, accountId, range, candidates);
  return { detected: candidates.length, created, autoResolved };
}

async function saveCandidates(db: AdminClient, accountId: string, candidates: AnomalyCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
  let created = 0;
  for (let i = 0; i < candidates.length; i += 200) {
    const batch = candidates.slice(i, i + 200).map((c) => ({
      account_id: accountId,
      franchise_id: c.franchiseId,
      driver_id: c.driverId,
      anomaly_type: c.type,
      severity: c.severity,
      subject_date: c.subjectDate,
      title: c.title,
      what_happened: c.whatHappened,
      actual_value: c.actualValue,
      expected_value: c.expectedValue,
      why_flagged: c.whyFlagged,
      suggested_action: c.suggestedAction,
      metric: c.metric as JsonObject,
      dedupe_key: c.dedupeKey,
    }));
    // ignoreDuplicates: an alert that already exists keeps its status and history.
    const { data, error } = await db.from("anomalies").upsert(batch, { onConflict: "account_id,dedupe_key", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`Saving alerts failed: ${error.message}`);
    created += data?.length ?? 0;
  }
  return created;
}

const SELF_CLOSING = ["missing_franchise_report", "missing_driver_report", "missing_fuel", "unregistered_driver", "source_conflict"];

/** Closes "something is missing" alerts once the missing thing has turned up. Never touches alerts the owner has decided on. */
async function closeStaleAlerts(
  db: AdminClient,
  accountId: string,
  range: { from: ISODate; to: ISODate },
  candidates: AnomalyCandidate[],
): Promise<number> {
  const current = new Set(candidates.map((c) => c.dedupeKey));
  const open = await fetchAll(() =>
    db.from("anomalies").select("id, anomaly_type, dedupe_key, subject_date, metric, franchise_id")
      .eq("account_id", accountId).in("status", ["open", "investigating"]).in("anomaly_type", SELF_CLOSING).order("id"),
  );
  const toClose: string[] = [];
  for (const alert of open) {
    if (current.has(alert.dedupe_key)) continue;
    if (alert.anomaly_type === "unregistered_driver") {
      const driverKey = (alert.metric as { driverKey?: string } | null)?.driverKey;
      if (!driverKey || !alert.franchise_id) continue;
      const { count } = await db.from("daily_earnings").select("id", { count: "exact", head: true })
        .eq("account_id", accountId).eq("franchise_id", alert.franchise_id).eq("driver_key", driverKey).is("driver_id", null).eq("is_current", true);
      if ((count ?? 0) === 0) toClose.push(alert.id);
    } else if (alert.anomaly_type === "source_conflict") {
      const reviewItemId = (alert.metric as { reviewItemId?: string } | null)?.reviewItemId;
      if (!reviewItemId) continue;
      const { data } = await db.from("review_items").select("status").eq("id", reviewItemId).maybeSingle();
      if (!data || data.status !== "open") toClose.push(alert.id);
    } else if (alert.subject_date >= range.from && alert.subject_date <= range.to) {
      // Evaluated in this run and no longer detected: the information has arrived.
      toClose.push(alert.id);
    }
  }
  if (toClose.length === 0) return 0;
  const { error } = await db.from("anomalies").update({
    status: "resolved", auto_resolved: true, status_changed_at: new Date().toISOString(),
    status_note: "Closed automatically: this no longer applies.",
  }).in("id", toClose);
  if (error) throw new Error(`Closing alerts failed: ${error.message}`);
  return toClose.length;
}
