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
