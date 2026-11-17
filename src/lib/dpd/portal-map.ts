/**
 * The portal map: a small, reviewable description of where things are in the
 * DPD partner portal. Nothing about the real portal is hard-coded — the map is
 * written after a discovery run against the real portal and stored with the
 * DPD connection (integration_connections.config.portalMap).
 *
 * Locators are expressed as accessible roles and names (what a person would
 * see), not CSS paths, so they survive cosmetic changes.
 */

import { z } from "zod";
import type { ISODate } from "@/lib/dates";

const target = z.object({
  role: z.enum(["link", "button", "tab", "menuitem"]),
  /** Visible name. May contain {fd} and {date:…} tokens. */
  name: z.string().min(1),
  exact: z.boolean().optional(),
});

const step = z.discriminatedUnion("action", [
  z.object({ action: z.literal("goto"), path: z.string().min(1) }),
  z.object({ action: z.literal("click"), target }),
  /** Choose an option in a labelled drop-down filter (a filter only, never a form submission). The option text may contain {fd}. */
  z.object({ action: z.literal("select"), label: z.string().min(1), option: z.string().min(1) }),
]);

const dateSelection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  /** Reload the current page with ?param=<date>. */
  z.object({ mode: z.literal("url_param"), param: z.string().min(1), format: z.string().default("yyyy-MM-dd") }),
  /** Click a link/tab named after the date. */
  z.object({ mode: z.literal("click"), target }),
  /** Type the date into a labelled filter box and press a (read-only) apply button. */
  z.object({ mode: z.literal("input"), label: z.string().min(1), format: z.string().default("dd/MM/yyyy"), apply: target }),
  /**
   * Pick the reporting period that contains the date, from a "Year" drop-down and a "Period" drop-down whose
   * options read like "9th November 2026 - 6th December 2026". The selected period is then available to
   * table transforms as {periodStart:FORMAT} and {periodEnd:FORMAT}.
   */
  z.object({ mode: z.literal("period_select"), yearLabel: z.string().default("year"), periodLabel: z.string().default("period") }),
]);

/**
 * Reshapes an on-page table before it goes to the import pipeline, so the
 * portal's own headings and cells can be read by the existing column
 * recogniser. Applied in this order: headers/rename, dropRows, clean, split, add.
 * Column names in clean/split/add are the names AFTER renaming.
 */
export const tableTransformSchema = z.object({
  /** Replace the whole header row (must have the same number of cells). */
  headers: z.array(z.string()).optional(),
  /** Rename headings in one pass (exact match, ignoring case): {"Total": "Gross earnings"}. */
  rename: z.record(z.string(), z.string()).optional(),
  /** Remove data rows whose first non-empty cell matches one of these regular expressions. */
  dropRows: z.array(z.string()).default([]),
  /** Regular-expression replacement inside one column's cells, e.g. remove " (excl. £2.29 VAT)". */
  clean: z.array(z.object({ column: z.string(), pattern: z.string(), replace: z.string().default("") })).default([]),
  /** Split one column with a regular expression of two groups: group 1 goes to a new column, group 2 stays. */
  split: z.array(z.object({ column: z.string(), pattern: z.string(), into: z.tuple([z.string(), z.string()]) })).default([]),
  /** Add a column holding the same text on every row. May use {fd}, {date:FORMAT}, {periodStart:FORMAT}, {periodEnd:FORMAT}. */
  add: z.array(z.object({ header: z.string(), value: z.string() })).default([]),
});
export type TableTransform = z.infer<typeof tableTransformSchema>;

const collect = z.discriminatedUnion("mode", [
  /** Click something that triggers a file download. */
  z.object({ mode: z.literal("download"), trigger: target }),
  /** Fetch every link on the page whose name matches (e.g. one PDF per driver). */
  z.object({ mode: z.literal("links"), namePattern: z.string().min(1), max: z.number().int().positive().max(100).default(40) }),
  /** Read an on-page table (converted to CSV for the import pipeline). tables "all" joins every table on the page that shares the first table's headings. */
  z.object({
    mode: z.literal("table"),
    tableName: z.string().optional(),
    tables: z.enum(["first", "all"]).default("first"),
    /** With tables "all": only join tables whose heading cells, joined with "|", match this regular expression. Other tables on the page are ignored. */
    tableHeader: z.string().optional(),
    transform: tableTransformSchema.optional(),
  }),
]);

export const reportSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  kind: z.enum(["earnings", "fuel", "expenses"]),
  /** Steps from the franchise's landing page to the report page. */
  navigate: z.array(step).max(8),
  date: dateSelection.default({ mode: "none" }),
  collect,
});

export const portalMapSchema = z.object({
  version: z.literal(1),
  login: z
    .object({
      path: z.string().default(""),
      usernameLabel: z.string().default("user|email|login"),
      passwordLabel: z.string().default("password"),
      /** Label of an extra login field filled from DPD_LOGIN_SECRET, if the portal has one. */
      secretLabel: z.string().optional(),
      submitName: z.string().default("log ?in|sign ?in|continue|submit"),
      /** Something only visible when signed in. */
      signedInName: z.string().default("log ?out|sign ?out"),
      /** URL patterns (regular expressions) allowed to receive the sign-in POST. Empty = same page as the login form. */
      postPatterns: z.array(z.string()).default([]),
    })
    .default({ path: "", usernameLabel: "user|email|login", passwordLabel: "password", submitName: "log ?in|sign ?in|continue|submit", signedInName: "log ?out|sign ?out", postPatterns: [] }),
  /**
   * URL patterns for POST requests that only READ data (for example a search
   * or GraphQL query endpoint). Every entry must be justified in review:
   * anything not listed is blocked.
   */
  readOnlyPostPatterns: z.array(z.string()).default([]),
  franchise: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("none") }),
    z.object({ mode: z.literal("url"), template: z.string().min(1) }),
    z.object({ mode: z.literal("steps"), steps: z.array(step).min(1).max(6) }),
  ]),
  reports: z.array(reportSchema).min(1).max(12),
  /** Minimum pause between page loads, in milliseconds. */
  delayMs: z.number().int().min(250).max(30_000).default(1500),
});

export type PortalMap = z.infer<typeof portalMapSchema>;
export type PortalReport = z.infer<typeof reportSchema>;
export type PortalStep = z.infer<typeof step>;
export type PortalTarget = z.infer<typeof target>;

export function formatDateToken(date: ISODate, format: string): string {
  const [yyyy, MM, dd] = date.split("-") as [string, string, string];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return format
    .replace(/yyyy/g, yyyy)
    .replace(/yy/g, yyyy.slice(2))
    .replace(/MMM/g, months[Number(MM) - 1]!)
    .replace(/MM/g, MM)
    .replace(/dd/g, dd)
    .replace(/\bd\b/g, String(Number(dd)))
    .replace(/\bM\b/g, String(Number(MM)));
}

/** What a template can refer to. `period` is set once a period has been selected on the page. */
export interface TemplateValues {
  fd: string;
  date: ISODate;
  period?: { start: ISODate; end: ISODate } | null;
}

/** Fills {fd}, {date:FORMAT}, {periodStart:FORMAT} and {periodEnd:FORMAT} tokens in a template. */
export function fillTemplate(template: string, values: TemplateValues): string {
  const period = (which: "start" | "end", token: string): string => {
    if (!values.period) throw new Error(`The template uses ${token} but no reporting period has been selected.`);
    return values.period[which];
  };
  return template
    .replace(/\{fd\}/g, values.fd)
    .replace(/\{periodStart:([^}]+)\}/g, (_, format: string) => formatDateToken(period("start", "{periodStart}"), format))
    .replace(/\{periodEnd:([^}]+)\}/g, (_, format: string) => formatDateToken(period("end", "{periodEnd}"), format))
    .replace(/\{periodStart\}/g, () => period("start", "{periodStart}"))
    .replace(/\{periodEnd\}/g, () => period("end", "{periodEnd}"))
    .replace(/\{date:([^}]+)\}/g, (_, format: string) => formatDateToken(values.date, format))
    .replace(/\{date\}/g, values.date);
}
