/**
 * Read-only exploration of the DPD partner portal, run from your own machine
 * or the worker host. Writes docs/PORTAL_INVENTORY.generated.md.
 *
 *   DPD_PORTAL_URL=… DPD_USERNAME=… DPD_PASSWORD=… npm run dpd:discover [-- --max-pages 60]
 *
 * It signs in with the supplied authorised credentials and follows ordinary
 * links only. The read-only guard blocks every request that is not a GET (apart
 * from the sign-in itself). It stops — and says so — at MFA or a CAPTCHA.
 * It records the SHAPE of pages (headings, column names, file types), never
 * the data in them.
 */
import { writeFileSync } from "node:fs";
import { discoverPortal, inventoryMarkdown } from "@/lib/dpd/discovery";
import { PortalError } from "@/lib/dpd/errors";
import { portalMapSchema } from "@/lib/dpd/portal-map";
import { PortalSession } from "@/lib/dpd/session";
import { env } from "@/lib/env";
import { arg, loadLocalEnv } from "./lib/env";

loadLocalEnv();

async function main() {
  const credentials = env.dpd();
  if (!credentials) {
    console.error("Set DPD_PORTAL_URL, DPD_USERNAME and DPD_PASSWORD first. Nothing has been contacted.");
    process.exit(1);
  }
  const map = portalMapSchema.parse({ version: 1, franchise: { mode: "none" }, reports: [{ id: "placeholder", label: "placeholder", kind: "earnings", navigate: [], collect: { mode: "table" } }] });
  const session = await PortalSession.open(credentials, map);
  try {
    console.log("Signing in (read-only)…");
    await session.login();
    console.log("Signed in. Exploring…");
    const result = await discoverPortal(session, {
      maxPages: Number(arg("max-pages", "60")),
      onProgress: (visited, queued) => process.stdout.write(`\r${visited} pages visited, ${queued} queued   `),
    });
    process.stdout.write("\n");
    const out = "docs/PORTAL_INVENTORY.generated.md";
    writeFileSync(out, inventoryMarkdown(result));
    writeFileSync("docs/PORTAL_INVENTORY.generated.json", JSON.stringify(result, null, 2));
    console.log(`Done: ${result.pages.length} page types. Written to ${out}. Requests blocked by the read-only guard: ${result.blockedRequests}.`);
  } catch (error) {
    if (error instanceof PortalError) {
      console.error(`\n${error.plainEnglish}\n(step: ${error.step})`);
      process.exit(2);
    }
    throw error;
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
