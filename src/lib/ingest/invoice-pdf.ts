/**
 * Reads a DPD self-billed invoice PDF. The portal's invoices are pictures with no text layer, so the page is rendered
 * and run through Tesseract (needs the `tesseract-ocr` and `poppler-utils` packages). Recognition is not perfect, so
 * several settings are tried and the first reading whose lines add up to the invoice's own net total is used.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseSelfBilledInvoice, type ParsedInvoice } from "./invoice";

const run = promisify(execFile);

const VARIANTS: { dpi: number; psm: number }[] = [
  { dpi: 220, psm: 6 },
  { dpi: 300, psm: 6 },
  { dpi: 300, psm: 4 },
  { dpi: 400, psm: 6 },
  { dpi: 250, psm: 11 },
];

/** The parsed invoice (or null), how many readings were tried, and the text of the reading used (kept for checking by hand). */
export async function readSelfBilledInvoicePdf(bytes: Uint8Array): Promise<{ invoice: ParsedInvoice | null; attempts: number; text: string }> {
  const dir = await mkdtemp(join(tmpdir(), "dpd-invoice-"));
  try {
    const pdf = join(dir, "invoice.pdf");
    await writeFile(pdf, bytes);
    let best: ParsedInvoice | null = null;
    let bestText = "";
    let attempts = 0;
    for (const { dpi, psm } of VARIANTS) {
      attempts += 1;
      const base = join(dir, `page-${dpi}`);
      try {
        await run("pdftoppm", ["-r", String(dpi), "-png", "-singlefile", pdf, base], { timeout: 60_000 });
        await run("tesseract", [`${base}.png`, base, "--psm", String(psm)], { timeout: 90_000, env: { ...process.env, OMP_THREAD_LIMIT: "1" } });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Reading invoices needs the tesseract-ocr and poppler-utils packages installed.");
        continue;
      }
      const text = await readFile(`${base}.txt`, "utf8");
      const parsed = parseSelfBilledInvoice(text);
      if (parsed?.reconciled) return { invoice: parsed, attempts, text };
      if (parsed && (best === null || parsed.problems.length < best.problems.length)) { best = parsed; bestText = text; }
      if (!best && text.length > bestText.length) bestText = text;
    }
    return { invoice: best, attempts, text: bestText };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
