/**
 * Dry run of the DPD portal map against the real portal. Nothing is saved.
 *
 *   npm run dpd:try-map -- --fd FD42102,FD46578 [--date 2026-11-16] [--map src/lib/dpd/portal-map.json] [--out ./csv-out]
 *
 * Signs in (read-only), collects every report in the map for each FD number,
 * reads it with the same parser the real import uses, and prints what would be
 * imported: counts, date range and totals. Driver names are not printed.
 * With --out the collected files are also written there (they contain real
 * driver names and pay, so keep them out of the repository).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { londonToday, isISODate } from "@/lib/dates";
import { PortalError } from "@/lib/dpd/errors";
import { portalMapSchema } from "@/lib/dpd/portal-map";
import { PortalSession } from "@/lib/dpd/session";
import { env } from "@/lib/env";
import { extractDocument } from "@/lib/ingest/extract";
import { parseDocument } from "@/lib/ingest/parse";
import { formatGBP, sumPence } from "@/lib/money";
import { arg, loadLocalEnv } from "./lib/env";

loadLocalEnv();

async function main() {
  const credentials = env.dpd();
  if (!credentials) {
    console.error("Set DPD_PORTAL_URL, DPD_USERNAME and DPD_PASSWORD first. Nothing has been contacted.");
    process.exit(1);
  }
  const fds = (arg("fd", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fds.length === 0) {
    console.error("Give at least one FD number: --fd FD12345,FD67890");
    process.exit(1);
  }
  const date = arg("date", londonToday()) ?? londonToday();
  if (!isISODate(date)) {
    console.error("--date must look like 2026-11-16");
    process.exit(1);
  }
  const map = portalMapSchema.parse(JSON.parse(readFileSync(arg("map", "src/lib/dpd/portal-map.json") ?? "src/lib/dpd/portal-map.json", "utf8")));
  const out = arg("out", "") ?? "";
  if (out) mkdirSync(out, { recursive: true });

  const session = await PortalSession.open(credentials, map);
  let problems = 0;
  try {
    console.log("Signing in (read-only)…");
    await session.login();
    for (const fd of fds) {
      for (const report of map.reports) {
        const label = `${fd} · ${report.label}`;
        try {
          await session.openFranchise(fd, date);
          const documents = await session.collectReport(report, fd, date);
          for (const document of documents) {
            if (out) writeFileSync(join(out, document.filename), document.bytes);
            const parsed = parseDocument(await extractDocument(document.filename, document.bytes));
            const rows = parsed.documentType === "earnings_report" ? parsed.earnings : parsed.documentType === "expense_report" ? parsed.expenses : parsed.fuel;
            const total = parsed.documentType === "earnings_report" ? sumPence(parsed.earnings.map((r) => r.gross - r.deductions + r.additional)) : parsed.documentType === "expense_report" ? sumPence(parsed.expenses.map((r) => r.amount)) : sumPence(parsed.fuel.map((r) => r.total));
            const wanted = report.kind === "earnings" ? "earnings_report" : report.kind === "expenses" ? "expense_report" : "fuel_report";
            const ok = parsed.documentType === wanted && rows.length > 0;
            if (!ok) problems += 1;
            console.log(`${ok ? "OK  " : "FAIL"} ${label}: read as ${parsed.documentType}, ${rows.length} row(s), confidence ${parsed.confidence.toFixed(2)}, total ${formatGBP(total)}, dates ${parsed.dateFrom ?? "?"} to ${parsed.dateTo ?? "?"}`);
            for (const issue of parsed.issues.filter((i) => i.level !== "info").slice(0, 5)) console.log(`       ${issue.level}: ${issue.message}`);
          }
        } catch (error) {
          problems += 1;
          console.log(`FAIL ${label}: ${error instanceof PortalError ? `${error.plainEnglish} (step ${error.step}: ${error.message})` : (error as Error).message}`);
        }
      }
    }
    console.log(`Requests blocked by the read-only guard: ${session.guard.blocked.length}`);
    for (const blocked of session.guard.blocked.slice(0, 10)) console.log(`  ${blocked.method} ${blocked.url}`);
  } finally {
    await session.close();
  }
  process.exit(problems > 0 ? 2 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
