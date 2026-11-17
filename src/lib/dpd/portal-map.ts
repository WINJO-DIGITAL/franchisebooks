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
]);

const dateSelection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  /** Reload the current page with ?param=<date>. */
  z.object({ mode: z.literal("url_param"), param: z.string().min(1), format: z.string().default("yyyy-MM-dd") }),
  /** Click a link/tab named after the date. */
  z.object({ mode: z.literal("click"), target }),
  /** Type the date into a labelled filter box and press a (read-only) apply button. */
  z.object({ mode: z.literal("input"), label: z.string().min(1), format: z.string().default("dd/MM/yyyy"), apply: target }),
]);

const collect = z.discriminatedUnion("mode", [
  /** Click something that triggers a file download. */
  z.object({ mode: z.literal("download"), trigger: target }),
  /** Fetch every link on the page whose name matches (e.g. one PDF per driver). */
  z.object({ mode: z.literal("links"), namePattern: z.string().min(1), max: z.number().int().positive().max(100).default(40) }),
  /** Read an on-page table (converted to CSV for the import pipeline). */
  z.object({ mode: z.literal("table"), tableName: z.string().optional() }),
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

/** Fills {fd} and {date:FORMAT} tokens in a template. */
export function fillTemplate(template: string, values: { fd: string; date: ISODate }): string {
  return template
    .replace(/\{fd\}/g, values.fd)
    .replace(/\{date:([^}]+)\}/g, (_, format: string) => formatDateToken(values.date, format))
    .replace(/\{date\}/g, values.date);
}
