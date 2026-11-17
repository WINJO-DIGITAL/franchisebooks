import { readFileSync } from "node:fs";
import { PortalSession } from "@/lib/dpd/session";
import { portalMapSchema } from "@/lib/dpd/portal-map";
import { env } from "@/lib/env";
import { readSelfBilledInvoicePdf } from "@/lib/ingest/invoice-pdf";

const map = portalMapSchema.parse(JSON.parse(readFileSync("docs/dpd-portal-map.json", "utf8")));
const report = map.reports.find((r) => r.id === "invoices")!;
const inv: { invoiceNo: string; fdNumber: string; invoiceDate: string }[] = JSON.parse(readFileSync("/tmp/claude-0/dpd-invoices/read.json", "utf8")).map((e: { invoice: unknown }) => e.invoice).filter(Boolean);
const latest2026 = (fd: string) => inv.filter((i) => i.fdNumber === fd && i.invoiceDate.startsWith("2026")).sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))[0]!.invoiceNo;
const hold = new Set([latest2026("FD42102"), latest2026("FD46578")]);
const known = new Set(inv.map((i) => i.invoiceNo).filter((n) => !hold.has(n)));
console.log("known", known.size, "held back", [...hold]);

const session = await PortalSession.open(env.dpd()!, map);
try {
  await session.login();
  for (const fd of ["FD42102", "FD46578", "FD52874", "FD68711"]) {
    await session.openFranchise(fd, "2026-11-17");
    const docs = await session.collectReport(report, fd, "2026-11-17", { knownInvoiceNumbers: known });
    console.log(fd, "new documents:", docs.map((d) => d.filename));
    for (const d of docs) {
      const { invoice } = await readSelfBilledInvoicePdf(d.bytes);
      console.log("  ", d.bytes.length, "bytes →", invoice ? `${invoice.invoiceNo} ${invoice.fdNumber} ${invoice.periodStart}..${invoice.periodEnd} reconciled=${invoice.reconciled}` : "UNREADABLE");
    }
  }
} finally {
  await session.close();
}
