/**
 * Date handling.
 *
 * Business dates (report dates, earnings dates) are calendar days in the UK.
 * They are carried as ISO strings ("2026-11-14") and never as JavaScript Date
 * objects, so a date can never shift because of a server timezone or DST.
 */

export type ISODate = string; // YYYY-MM-DD
export type YearMonth = string; // YYYY-MM

export const UK_TIMEZONE = "Europe/London";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function build(year: number, month: number, day: number): ISODate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!m && build(Number(m[1]), Number(m[2]), Number(m[3])) === value;
}

function toUtc(date: ISODate): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Parses a date written the UK way: 14/11/2026, 14-11-26, 14.11.2026,
 * "14 Nov 2026", "Saturday 14 November 2026", "14-Nov-26", or ISO 2026-11-14.
 * Day always comes before month for numeric dates. Returns null if unreadable.
 */
export function parseUkDate(input: string | null | undefined): ISODate | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/\s+/g, " ");
  if (s === "") return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return build(year, Number(m[2]), Number(m[1]));
  }

  m = /^(?:[A-Za-z]+,? )?(\d{1,2})(?:st|nd|rd|th)?[ \-]([A-Za-z]{3,9})[ \-,]+(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return null;
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return build(year, month, Number(m[1]));
  }
  return null;
}

/** 14/11/2026 */
export function formatUkDate(date: ISODate | null | undefined): string {
  if (!date || !isISODate(date)) return "—";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** Sat 14 Nov 2026 */
export function formatUkDateLong(date: ISODate | null | undefined): string {
  if (!date || !isISODate(date)) return "—";
  const d = toUtc(date);
  const day = DAY_NAMES[d.getUTCDay()]!.slice(0, 3);
  const month = MONTH_NAMES[d.getUTCMonth()]!.slice(0, 3);
  return `${day} ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/** Saturday 14 November */
export function formatUkDayMonth(date: ISODate): string {
  const d = toUtc(date);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

/** 14/11/2026 20:31 in UK time, from an instant. */
export function formatUkDateTime(instant: string | Date | null | undefined): string {
  if (!instant) return "—";
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return "—";
  const parts = londonParts(d);
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** "5 minutes ago", "yesterday at 20:31" style description of an instant, UK time. */
export function formatRelative(instant: string | Date | null | undefined, now: Date = new Date()): string {
  if (!instant) return "never";
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) return "never";
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  }
  const parts = londonParts(d);
  const time = `${pad(parts.hour)}:${pad(parts.minute)}`;
  const day = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const today = londonToday(now);
  if (day === today) return `today at ${time}`;
  if (day === addDays(today, -1)) return `yesterday at ${time}`;
  return `${formatUkDate(day)} at ${time}`;
}

interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock parts of an instant in a timezone (default UK), DST-aware. */
export function zonedParts(instant: Date, timeZone: string = UK_TIMEZONE): LondonParts {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return { year: out.year!, month: out.month!, day: out.day!, hour: out.hour!, minute: out.minute! };
}

function londonParts(instant: Date): LondonParts {
  return zonedParts(instant, UK_TIMEZONE);
}

/** Today's date in the UK. */
export function londonToday(now: Date = new Date(), timeZone: string = UK_TIMEZONE): ISODate {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Current UK wall-clock time as minutes since midnight. */
export function londonMinutesOfDay(now: Date = new Date(), timeZone: string = UK_TIMEZONE): number {
  const p = zonedParts(now, timeZone);
  return p.hour * 60 + p.minute;
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: ISODate): number {
  return toUtc(date).getUTCDay();
}

export function weekdayName(date: ISODate): string {
  return DAY_NAMES[weekdayOf(date)]!;
}

/** Monday of the week containing `date`. */
export function weekStart(date: ISODate): ISODate {
  const dow = weekdayOf(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isYearMonth(value: unknown): value is YearMonth {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function monthOf(date: ISODate): YearMonth {
  return date.slice(0, 7);
}

export function monthRange(month: YearMonth): { start: ISODate; end: ISODate } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${pad(last)}` };
}

export function addMonths(month: YearMonth, delta: number): YearMonth {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** November 2026 */
export function formatMonth(month: YearMonth): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Parses "HH:MM" or "HH:MM:SS" to minutes since midnight. */
export function parseTimeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
