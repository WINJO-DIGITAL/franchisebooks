import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBusinessCostCategory, summariseCosts, type SummaryCost } from "@/lib/finance/cost-summary";
import { extractDocument } from "@/lib/ingest/extract";
import { fdNumbersMatch, parseSelfBilledInvoice, readFdNumber } from "@/lib/ingest/invoice";
import { classifyInvoice, describeUnreadable } from "@/lib/ingest/invoice-import";
import { parseDocument } from "@/lib/ingest/parse";
import { setupChecklist } from "@/lib/onboarding/steps";

const parse = async (name: string, text: string) => parseDocument(await extractDocument(name, new Uint8Array(Buffer.from(text, "utf8"))));
const fuelFile = (header: string, rows: string[]) =>
  ["Fuel Card Transactions,Franchise: FD-TEST-1,SYNTHETIC TEST DATA", header, ...rows].join("\r\n") + "\r\n";

describe("fuel files and VAT", () => {
  it("a file with only a total and no VAT is shown as VAT not stated (no 20% is assumed)", async () => {
    const doc = await parse("fuel.csv", fuelFile("Date,Registration,Site,Litres,PPL,Total,Reference", ["10/11/2026,AB12CDE,Site A,40.00,1.500,60.00,TX1"]));
    expect(doc.fuel[0]).toMatchObject({ total: 6000, vat: null, vatBasis: "not_stated" });
  });
  it("a total whose heading says it includes VAT is VAT-inclusive, with the VAT not split out", async () => {
    const doc = await parse("fuel.csv", fuelFile("Date,Registration,Site,Litres,PPL,Total (inc. VAT),Reference", ["10/11/2026,AB12CDE,Site A,40.00,1.500,60.00,TX1"]));
    expect(doc.fuel[0]).toMatchObject({ total: 6000, vat: null, vatBasis: "gross" });
  });
  it("a total with a VAT column keeps the stated VAT and stores the amount before VAT", async () => {
    const doc = await parse("fuel.csv", fuelFile("Date,Registration,Site,Litres,PPL,VAT,Total,Reference", ["10/11/2026,AB12CDE,Site A,40.00,1.500,10.00,60.00,TX1"]));
    expect(doc.fuel[0]).toMatchObject({ total: 5000, vat: 1000, vatBasis: "net" });
  });
  it("a net column is before VAT, with the VAT column kept when there is one", async () => {
    const doc = await parse("fuel.csv", fuelFile("Date,Registration,Site,Litres,PPL,Net,VAT,Reference", ["10/11/2026,AB12CDE,Site A,40.00,1.500,50.00,10.00,TX1"]));
    expect(doc.fuel[0]).toMatchObject({ total: 5000, vat: 1000, vatBasis: "net" });
  });
});

describe("expenses page totals", () => {
  const costs: SummaryCost[] = [
    { kind: "expense", categoryName: "Vehicle hire", amount: 50000, vat: 10000, vatBasis: "net" },
    { kind: "fuel", categoryName: "Fuel", amount: 6000, vat: null, vatBasis: "not_stated" },
    { kind: "fuel", categoryName: "Fuel", amount: 3000, vat: null, vatBasis: "gross" },
    { kind: "expense", categoryName: "Insurance", amount: 20000, vat: null, vatBasis: "not_stated" },
  ];
  it("keeps VAT-not-stated costs out of Before VAT and shows them on their own line", () => {
    const s = summariseCosts(costs);
    expect(s.beforeVat).toBe(50000);
    expect(s.vat).toBe(10000);
    expect(s.withVat).toBe(63000);
    expect(s.vatInclusive).toBe(3000);
    expect(s.vatNotStated).toBe(26000);
    expect(s.vatNotStatedCount).toBe(2);
    expect(s.totalSpent).toBe(89000);
  });
  it("gives a subtotal for each category, marking business costs", () => {
    expect(summariseCosts(costs).byCategory).toEqual([
      { name: "Vehicle hire", count: 1, amount: 50000, vat: 10000, businessCost: false },
      { name: "Insurance", count: 1, amount: 20000, vat: 0, businessCost: true },
      { name: "Fuel", count: 2, amount: 9000, vat: 0, businessCost: false },
    ]);
  });
  it("treats insurance, the franchise fee and vehicle maintenance as business costs", () => {
    expect(["Insurance", "franchise fee", "Vehicle maintenance"].every(isBusinessCostCategory)).toBe(true);
    expect(isBusinessCostCategory("Fuel")).toBe(false);
    expect(isBusinessCostCategory(null)).toBe(false);
  });
});

describe("reading the FD number on DPD invoices (FD75486 and FD75488)", () => {
  const sample = readFileSync("tests/fixtures/dpd-invoice-ocr.txt", "utf8");
  it("tolerates spaces and look-alike letters that recognition adds", () => {
    expect(readFdNumber("FD number: FD 75486")).toBe("FD75486");
    expect(readFdNumber("FD Number FD75 488")).toBe("FD75488");
    expect(readFdNumber("FDnumber:FD7S486")).toBe("FD7S486");
    expect(readFdNumber("FD number: FD754O6")).toBe("FD75406");
    expect(fdNumbersMatch("FD75486", "FD7S486")).toBe(true);
  });
  it("never mixes up the sibling franchises", () => {
    expect(fdNumbersMatch("FD75486", "FD75488")).toBe(false);
    expect(fdNumbersMatch("FD75488", "FD75486")).toBe(false);
  });
  it("reads an invoice whose number and FD number came out with spaces", () => {
    const spaced = sample.replace("Invoice no: FI1041458", "Invoice No.: FI 1041458").replace("FD number: FD42102", "FD Number: FD 42102");
    const inv = parseSelfBilledInvoice(spaced)!;
    expect(inv.invoiceNo).toBe("FI1041458");
    expect(inv.fdNumber).toBe("FD42102");
    expect(classifyInvoice(inv, "FD42102")).toBe("stored");
    expect(classifyInvoice(inv, "FD42108")).toBe("wrong_franchise");
  });
  it("says what was missing from an invoice it could not read", () => {
    expect(describeUnreadable("")).toBe("no text could be recognised on it");
    expect(describeUnreadable(sample.replace(/FD number: FD42102/, ""))).toBe("no FD number found");
  });
});

describe("first-franchisee checklist", () => {
  const start = { franchiseCount: 0, hasDpdLogin: false, firstReadDone: false, driverCount: 0, driversWithoutRate: 0, ratesMatter: true };
  it("lists the three steps, ticking off what is done", () => {
    expect(setupChecklist(start).map((i) => [i.key, i.done])).toEqual([["login", false], ["first-read", false], ["rates", false]]);
    const afterSync = setupChecklist({ ...start, hasDpdLogin: true, firstReadDone: true, franchiseCount: 2, driverCount: 6, driversWithoutRate: 4 });
    expect(afterSync.map((i) => [i.key, i.done])).toEqual([["login", true], ["first-read", true], ["rates", false]]);
    expect(afterSync[2]!.title).toBe("Set the pay rate for 4 drivers");
  });
  it("goes away once every driver who worked has a pay rate", () => {
    expect(setupChecklist({ ...start, hasDpdLogin: true, firstReadDone: true, franchiseCount: 2, driverCount: 6, driversWithoutRate: 0 })).toEqual([]);
  });
});
