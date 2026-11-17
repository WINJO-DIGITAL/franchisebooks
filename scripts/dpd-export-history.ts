/**
 * Exports the full Payments and Transaction Charges history for each FD number
 * from the DPD portal, read-only, using the portal map. Writes the collected
 * documents and a parsed JSON file to --out (keep that folder out of the repo:
 * it contains driver names and pay).
 *
 *   npm run dpd:export -- --fd FD42102,FD46578 --out /path/outside/repo
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePeriodText } from "@/lib/dpd/period";
import { PortalError } from "@/lib/dpd/errors";
import { portalMapSchema, type PortalReport } from "@/lib/dpd/portal-map";
import { PortalSession } from "@/lib/dpd/session";
import { env } from "@/lib/env";
import { extractDocument } from "@/lib/ingest/extract";
import { parseDocument } from "@/lib/ingest/parse";
import { addDays } from "@/lib/dates";
import { arg, loadLocalEnv } from "./lib/env";

loadLocalEnv();

async function main() {
  const credentials = env.dpd();
  if (!credentials) throw new Error("Set DPD_PORTAL_URL, DPD_USERNAME and DPD_PASSWORD first.");
  const fds = (arg("fd", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const out = arg("out", "") ?? "";
  if (fds.length === 0 || !out) throw new Error("Give --fd FD1,FD2 and --out <folder outside the repo>.");
  const map = portalMapSchema.parse(JSON.parse(readFileSync("docs/dpd-portal-map.json", "utf8")));
  const periodTexts: string[] = JSON.parse(readFileSync(arg("periods", "/tmp/claude-0/dpd-data/period-texts.json") ?? "", "utf8"));
  const periods = periodTexts.map((t) => parsePeriodText(t)).filter((p): p is { start: string; end: string } => p !== null);
  mkdirSync(out, { recursive: true });
  // --retry <export.json>: only re-read the periods that failed in an earlier export.
  const retryFrom = arg("retry", "") ?? "";
  const retry = retryFrom ? new Set<string>(JSON.parse(readFileSync(retryFrom, "utf8")).failures.map((f: string) => f.split(":")[0])) : null;

  const session = await PortalSession.open(credentials, map);
  const results: Record<string, unknown>[] = [];
  const failures: string[] = [];
  try {
    await session.login();
    for (const fd of fds) {
      for (const period of periods) {
        // Any date inside the period picks that period in the portal's drop-downs.
        const date = addDays(period.start, 1);
        for (const report of map.reports as PortalReport[]) {
          const label = `${fd} ${report.id} ${period.start}`;
          if (retry && !retry.has(label)) continue;
          try {
            await session.openFranchise(fd, date);
            const documents = await session.collectReport(report, fd, date);
            for (const document of documents) {
              const name = `${fd}_${report.id}_${period.start}.csv`;
              writeFileSync(join(out, name), document.bytes);
              const parsed = parseDocument(await extractDocument(name, document.bytes));
              results.push({ fd, report: report.id, period: period.start, periodEnd: period.end, documentType: parsed.documentType, confidence: parsed.confidence, issues: parsed.issues.filter((i) => i.level !== "info").slice(0, 5), earnings: parsed.earnings, expenses: parsed.expenses });
            }
            console.log(`ok   ${label}`);
          } catch (error) {
            const message = error instanceof PortalError ? `${error.plainEnglish} (${error.step})` : (error as Error).message;
            failures.push(`${label}: ${message}`);
            console.log(`FAIL ${label}: ${message}`);
          }
        }
      }
    }
    console.log(`Blocked by read-only guard: ${session.guard.blocked.length}`);
  } finally {
    await session.close();
    writeFileSync(join(out, "export.json"), JSON.stringify({ exportedAt: new Date().toISOString(), fds, results, failures }, null, 1));
    console.log(`Done: ${results.length} documents parsed, ${failures.length} failures. Written to ${out}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
