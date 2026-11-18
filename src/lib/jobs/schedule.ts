/**
 * The scheduler tick.
 *
 * Runs every few minutes (Vercel Cron and/or the worker's own timer — both
 * are safe to run together). On each tick, for every account:
 *   • once the configured UK-time sync time has passed, queue tonight's DPD
 *     sync for each active franchise (only once per franchise per day);
 *   • queue a Dropbox reconciliation sync if one is connected;
 *   • return crashed jobs to the queue;
 *   • after month end, queue the automatic monthly reports.
 *
 * The decision logic is a pure function so the timezone behaviour is tested.
 */

import { addMonths, londonMinutesOfDay, londonToday, monthOf, parseTimeToMinutes, type ISODate } from "@/lib/dates";

export interface ScheduleSettings {
  syncEnabled: boolean;
  syncTimeLocal: string;
  syncTimezone: string;
}

export interface ScheduleDecision {
  /** The business date the evening sync should collect. */
  reportDate: ISODate;
  /** True once the local wall-clock time has reached the configured sync time. */
  syncDue: boolean;
  /** The month whose automatic report should exist by now, or null on the 1st before the sync has run. */
  reportMonthDue: string | null;
}

export function decideSchedule(settings: ScheduleSettings, now: Date): ScheduleDecision {
  const timezone = settings.syncTimezone || "Europe/London";
  const today = londonToday(now, timezone);
  const minutes = londonMinutesOfDay(now, timezone);
  const syncAt = parseTimeToMinutes(settings.syncTimeLocal) ?? 20 * 60 + 30;
  const dayOfMonth = Number(today.slice(8, 10));
  return {
    reportDate: today,
    syncDue: settings.syncEnabled && minutes >= syncAt,
    // Generate last month's report from the 2nd, giving the final day's sync time to land.
    reportMonthDue: dayOfMonth >= 2 ? addMonths(monthOf(today), -1) : null,
  };
}

/**
 * Spreads accounts' nightly reads across a window, so that thousands of logins do not all reach DPD in the same minute.
 * An account starts between its chosen time and `windowMinutes` later, and the same account always gets the same offset.
 * Pure and deterministic (FNV-1a hash of the account id).
 */
export const STAGGER_WINDOW_MINUTES = 30;

export function staggerOffsetMinutes(accountId: string, windowMinutes = STAGGER_WINDOW_MINUTES): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < accountId.length; i++) {
    hash ^= accountId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % windowMinutes;
}

/** "20:30" plus the account's stagger offset, as "HH:MM". Returns the input unchanged if it cannot be read. */
export function staggeredSyncTime(syncTimeLocal: string, accountId: string, windowMinutes = STAGGER_WINDOW_MINUTES): string {
  const base = parseTimeToMinutes(syncTimeLocal);
  if (base == null) return syncTimeLocal;
  const minutes = (base + staggerOffsetMinutes(accountId, windowMinutes)) % (24 * 60);
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}
