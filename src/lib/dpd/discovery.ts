/**
 * Structured, read-only discovery of the DPD partner portal.
 *
 * After signing in, walks every page reachable through ordinary links on the
 * same site and records WHAT KIND of information each page offers — headings,
 * table column names, downloadable files, filters, forms. It does not record
 * the data itself (no table contents, no names, no figures), never fills in
 * or submits a form, and never follows a sign-out link.
 */

import type { PortalSession } from "./session";

export interface DiscoveredPage {
  path: string;
  title: string;
  headings: string[];
  tables: { caption: string; columns: string[]; rows: number }[];
  downloads: { text: string; extension: string }[];
  filters: { dateInputs: number; selects: { label: string; options: number }[] };
  forms: { method: string; fields: number; submitLabels: string[] }[];
  linkCount: number;
  topics: string[];
  depth: number;
}

export interface DiscoveryResult {
  startedAt: string;
  finishedAt: string;
  origin: string;
  pages: DiscoveredPage[];
  truncated: boolean;
  blockedRequests: number;
}

const TOPICS: [string, RegExp][] = [
  ["Daily earnings", /\b(earning|statement|remittance|self[- ]?bill|pay(ment)? (summary|report))/i],
  ["Driver performance", /\b(performance|scorecard|league|quality|kpi|predict|delivery success)/i],
  ["Parcel volumes", /\b(parcel|volume|consignment)/i],
  ["Completed stops", /\b(stop)s?\b/i],
  ["Fuel", /\b(fuel|diesel|litre|fuel ?card)/i],
  ["Expenses", /\b(expense|charge|recharge|cost)/i],
  ["Adjustments and deductions", /\b(adjust|deduction|debit|credit note|penalt|claim)/i],
  ["Franchise performance / revenue", /\b(franchise|revenue|invoice|turnover|income)/i],
  ["Vehicle information", /\b(vehicle|van|fleet|registration|mot\b)/i],
  ["Driver information", /\b(driver|courier)s?\b/i],
  ["Route information", /\b(route|round|depot)/i],
  ["Operational exceptions", /\b(exception|failed|missed|complaint|incident|damage)/i],
  ["Historical reports", /\b(histor|archive|previous|past (week|month))/i],
];

const DOWNLOAD_EXTENSIONS = /\.(pdf|csv|xlsx?|zip|txt)(\?|$)/i;
const NEVER_FOLLOW = /log ?out|sign ?out|log ?off|delete|remove|deactivate|unsubscribe/i;

export async function discoverPortal(
  session: PortalSession,
  options: { maxPages?: number; maxDepth?: number; onProgress?: (visited: number, queued: number) => void } = {},
): Promise<DiscoveryResult> {
  const maxPages = options.maxPages ?? 60;
  const maxDepth = options.maxDepth ?? 4;
  const startedAt = new Date().toISOString();
  const origin = new URL(session.page.url()).origin;
  const start = session.page.url();

  const queue: { url: string; depth: number }[] = [{ url: start, depth: 0 }];
  const seen = new Set<string>([normalise(start)]);
  const pages: DiscoveredPage[] = [];
  let truncated = false;

  while (queue.length > 0) {
    if (pages.length >= maxPages) {
      truncated = true;
      break;
    }
    const { url, depth } = queue.shift()!;
    try {
      await session.goto(url, `discover:${pages.length + 1}`);
    } catch {
      continue; // an unreachable page is skipped; discovery carries on
    }
    const snapshot = await session.page.evaluate(() => {
      const text = (el: Element | null) => ((el as HTMLElement | null)?.innerText ?? "").replace(/\s+/g, " ").trim();
      const labelFor = (el: Element) => {
        const id = el.getAttribute("id");
        const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        return text(explicit) || text(el.closest("label")) || el.getAttribute("aria-label") || el.getAttribute("name") || "";
      };
      return {
        title: document.title,
        headings: Array.from(document.querySelectorAll("h1,h2,h3")).map(text).filter(Boolean).slice(0, 15),
        tables: Array.from(document.querySelectorAll("table")).slice(0, 10).map((table) => ({
          caption: text(table.querySelector("caption")) || table.getAttribute("aria-label") || "",
          columns: Array.from(table.querySelectorAll("thead th, tr:first-child th")).map(text).filter(Boolean).slice(0, 30),
          rows: table.querySelectorAll("tbody tr").length,
        })),
        links: Array.from(document.querySelectorAll("a[href]")).map((a) => ({ href: (a as HTMLAnchorElement).href, text: text(a).slice(0, 80) })),
        dateInputs: document.querySelectorAll('input[type="date"], input[name*="date" i], input[placeholder*="date" i]').length,
        selects: Array.from(document.querySelectorAll("select")).slice(0, 10).map((s) => ({ label: labelFor(s).slice(0, 60), options: (s as HTMLSelectElement).options.length })),
        forms: Array.from(document.querySelectorAll("form")).slice(0, 10).map((form) => ({
          method: (form.getAttribute("method") || "get").toLowerCase(),
          fields: form.querySelectorAll("input:not([type=hidden]), select, textarea").length,
          submitLabels: Array.from(form.querySelectorAll('button, input[type="submit"]')).map((b) => text(b) || b.getAttribute("value") || "").filter(Boolean).slice(0, 5),
        })),
        bodySample: text(document.querySelector("main") ?? document.body).slice(0, 1500),
      };
    });

    const haystack = [snapshot.title, ...snapshot.headings, ...snapshot.tables.flatMap((t) => [t.caption, ...t.columns]), new URL(url).pathname].join(" ");
    const downloads = snapshot.links.filter((l) => DOWNLOAD_EXTENSIONS.test(l.href)).slice(0, 20)
      .map((l) => ({ text: l.text, extension: (DOWNLOAD_EXTENSIONS.exec(l.href)?.[1] ?? "").toLowerCase() }));

    pages.push({
      path: describePath(url),
      title: snapshot.title,
      headings: snapshot.headings,
      tables: snapshot.tables,
      downloads,
      filters: { dateInputs: snapshot.dateInputs, selects: snapshot.selects },
      forms: snapshot.forms,
      linkCount: snapshot.links.length,
      topics: TOPICS.filter(([, pattern]) => pattern.test(haystack)).map(([name]) => name),
      depth,
    });
    options.onProgress?.(pages.length, queue.length);

    if (depth >= maxDepth) continue;
    for (const link of snapshot.links) {
      let target: URL;
      try {
        target = new URL(link.href);
      } catch {
        continue;
      }
      if (target.origin !== origin) continue;
      if (!/^https?:$/.test(target.protocol)) continue;
      if (DOWNLOAD_EXTENSIONS.test(target.pathname)) continue;
      if (NEVER_FOLLOW.test(link.text) || NEVER_FOLLOW.test(target.pathname)) continue;
      target.hash = "";
      const key = normalise(target.toString());
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ url: target.toString(), depth: depth + 1 });
    }
  }

  return { startedAt, finishedAt: new Date().toISOString(), origin, pages, truncated, blockedRequests: session.guard.blocked.length };
}

/** Pages that differ only by an id or a date are the same kind of page; visit one of each. */
function normalise(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/\d{4}-\d{2}-\d{2}(?=\/|$)/g, "/:date").replace(/\/\d+(?=\/|$)/g, "/:id").replace(/\/$/, "");
  return `${u.origin}${path}?${[...u.searchParams.keys()].sort().join("&")}`;
}

function describePath(url: string): string {
  const u = new URL(url);
  const keys = [...u.searchParams.keys()];
  return keys.length ? `${u.pathname}?${keys.map((k) => `${k}=…`).join("&")}` : u.pathname;
}

/** Renders a discovery result as the portal capability inventory. */
export function inventoryMarkdown(result: DiscoveryResult): string {
  const lines: string[] = [
    "# DPD partner portal — observed capability inventory",
    "",
    `Generated by a read-only discovery run on ${result.finishedAt.slice(0, 10)}. ${result.pages.length} page type(s) visited${result.truncated ? " (stopped at the page limit — more exist)" : ""}.`,
    `Requests blocked by the read-only guard during the run: ${result.blockedRequests}.`,
    "",
    "Only the *shape* of each page is recorded (headings, column names, file types). No figures or personal data are captured.",
    "",
    "## By topic",
    "",
    "| Section | Pages found | Tabular data | Downloadable | Date filter (history) |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const [topic] of TOPICS) {
    const matches = result.pages.filter((p) => p.topics.includes(topic));
    if (matches.length === 0) {
      lines.push(`| ${topic} | None found | — | — | — |`);
      continue;
    }
    const tables = matches.some((p) => p.tables.some((t) => t.columns.length > 0));
    const downloads = [...new Set(matches.flatMap((p) => p.downloads.map((d) => d.extension.toUpperCase())))];
    const dates = matches.some((p) => p.filters.dateInputs > 0);
    lines.push(`| ${topic} | ${matches.map((p) => `\`${p.path}\``).slice(0, 4).join(", ")} | ${tables ? "Yes" : "No"} | ${downloads.length ? downloads.join(", ") : "No"} | ${dates ? "Yes" : "Not seen"} |`);
  }
  lines.push("", "## Every page visited", "");
  for (const page of result.pages) {
    lines.push(`### \`${page.path}\``, "", `*${page.title || "Untitled"}*${page.topics.length ? ` — ${page.topics.join(", ")}` : ""}`, "");
    if (page.headings.length) lines.push(`- Headings: ${page.headings.slice(0, 8).join(" · ")}`);
    for (const table of page.tables) {
      if (table.columns.length) lines.push(`- Table${table.caption ? ` “${table.caption}”` : ""} (${table.rows} rows): ${table.columns.join(" | ")}`);
    }
    if (page.downloads.length) lines.push(`- Downloads: ${page.downloads.map((d) => `${d.text || "file"} (.${d.extension})`).slice(0, 8).join(", ")}`);
    if (page.filters.dateInputs) lines.push(`- Date filters: ${page.filters.dateInputs}`);
    if (page.filters.selects.length) lines.push(`- Drop-downs: ${page.filters.selects.map((s) => `${s.label || "unnamed"} (${s.options})`).join(", ")}`);
    const writeForms = page.forms.filter((f) => f.method === "post");
    if (writeForms.length) lines.push(`- ⚠ Contains ${writeForms.length} form(s) that submit data (${writeForms.flatMap((f) => f.submitLabels).slice(0, 5).join(", ") || "unlabelled"}) — never used by the integration`);
    lines.push("");
  }
  return lines.join("\n");
}
