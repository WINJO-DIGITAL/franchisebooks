import { describe, expect, it } from "vitest";
import { classifyInvoice } from "@/lib/ingest/invoice-import";
import type { ParsedInvoice } from "@/lib/ingest/invoice";
import { portalMapSchema } from "@/lib/dpd/portal-map";

const invoice = (o: Partial<ParsedInvoice> = {}): ParsedInvoice => ({
  invoiceNo: "FI1041458", fdNumber: "FD42102", invoiceDate: "2026-11-08", dueDate: "2026-11-13", periodStart: "2026-10-12", periodEnd: "2026-11-08",
  lines: [], netTotal: 0, vatTotal: 0, invoiceTotal: 0, reconciled: true, totalsAgree: true, problems: [], ...o,
});

describe("classifying a downloaded self-billed invoice", () => {
  it("stores an invoice for the franchise it was listed under", () => {
    expect(classifyInvoice(invoice(), "FD42102")).toBe("stored");
  });
  it("treats a PDF that cannot be read as unreadable, so it is tried again", () => {
    expect(classifyInvoice(null, "FD42102")).toBe("unreadable");
  });
  it("refuses an invoice that belongs to another franchise", () => {
    expect(classifyInvoice(invoice({ fdNumber: "FD46578" }), "FD42102")).toBe("wrong_franchise");
  });
  it("flags an invoice with no billing period rather than storing a guess", () => {
    expect(classifyInvoice(invoice({ periodStart: "" as never }), "FD42102")).toBe("incomplete");
  });
});

describe("the portal setup's invoices report", () => {
  const base = { version: 1, login: undefined, franchise: { mode: "none" } };
  it("accepts an invoices report and fills in its defaults", () => {
    const map = portalMapSchema.parse({
      ...base,
      reports: [{ id: "invoices", label: "Self-billed invoices", kind: "invoices", navigate: [{ action: "goto", path: "/manage-account#/invoices" }], collect: { mode: "invoices" } }],
    });
    const collect = map.reports[0]!.collect;
    expect(collect).toMatchObject({ mode: "invoices", yearLabel: "Year", rowPattern: "Self Billed", numberColumn: 1, max: 40 });
  });
});
