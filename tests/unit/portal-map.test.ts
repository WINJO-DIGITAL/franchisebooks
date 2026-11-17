import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findPeriodIndex, parsePeriodText, tableShowsPeriod, yearCandidates } from "@/lib/dpd/period";
import { fillTemplate, portalMapSchema, tableTransformSchema } from "@/lib/dpd/portal-map";
import { transformTable } from "@/lib/dpd/table";
import { extractDocument } from "@/lib/ingest/extract";
import { parseDocument } from "@/lib/ingest/parse";

const values = { fd: "FD10001", date: "2026-11-16", period: { start: "2026-11-09", end: "2026-12-06" } } as const;

describe("period text", () => {
  it("reads the portal's period wording", () => {
    expect(parsePeriodText("9th November 2026 - 6th December 2026")).toEqual({ start: "2026-11-09", end: "2026-12-06" });
    expect(parsePeriodText("2nd March 2026 – 29th March 2026")).toEqual({ start: "2026-03-02", end: "2026-03-29" });
    expect(parsePeriodText("22nd June 2026 - 19th July 2026")?.start).toBe("2026-06-22");
  });

  it("rejects anything that is not a period", () => {
    expect(parsePeriodText("2026")).toBeNull();
    expect(parsePeriodText("6th December 2026 - 9th November 2026")).toBeNull();
    expect(parsePeriodText("Select a period")).toBeNull();
  });

  it("finds the period containing a date, including the first and last day", () => {
    const options = ["9th November 2026 - 6th December 2026", "12th October 2026 - 8th November 2026", "14th September 2026 - 11th October 2026"];
    expect(findPeriodIndex(options, "2026-11-16")).toBe(0);
    expect(findPeriodIndex(options, "2026-11-09")).toBe(0);
    expect(findPeriodIndex(options, "2026-11-08")).toBe(1);
    expect(findPeriodIndex(options, "2026-10-12")).toBe(1);
    expect(findPeriodIndex(options, "2026-12-07")).toBe(-1);
  });

  it("tries the date's own year first, then the neighbours (a December period can sit under the next year)", () => {
    expect(yearCandidates("2026-01-02")).toEqual(["2026", "2027", "2025"]);
  });
});

describe("a page that did not change period", () => {
  const header = ["Date", "Stops", "Parcels", "Gross", "Route", "Driver"];
  const row = (date: string) => [date, "10", "20", "£100.00", "1", "A B"];
  const period = { start: "2026-05-25", end: "2026-06-21" };

  it("is refused when none of its dates fall inside the selected period (it is still showing the current period)", () => {
    expect(tableShowsPeriod([header, row("16th November 2026"), row("14th November 2026")], period)).toBe(false);
  });
  it("is accepted when dates fall inside the period, even with late-posted rows dated before it", () => {
    expect(tableShowsPeriod([header, row("26th May 2026"), row("12th May 2026")], period)).toBe(true);
  });
  it("is accepted when it has no dated rows (an empty period) or no date column", () => {
    expect(tableShowsPeriod([header], period)).toBe(true);
    expect(tableShowsPeriod([["Description", "Charge", "Notes"], ["Fee", "£1", ""]], period)).toBe(true);
  });
});

describe("templates", () => {
  it("fills period tokens and still fills the old ones", () => {
    expect(fillTemplate("{fd} {periodStart:dd/MM/yyyy} {periodEnd:dd/MM/yyyy} {date}", values)).toBe("FD10001 09/11/2026 06/12/2026 2026-11-16");
  });

  it("refuses a period token when no period has been selected, instead of writing a wrong date", () => {
    expect(() => fillTemplate("{periodStart:dd/MM/yyyy}", { fd: "FD10001", date: "2026-11-16", period: null })).toThrow(/period/i);
    expect(fillTemplate("{fd}", { fd: "FD10001", date: "2026-11-16" })).toBe("FD10001");
  });
});

describe("transformTable", () => {
  const payments = [
    ["Payments"],
    ["Date", "Stops", "Total Parcels", "Excess Parcels", "Stop", "Parcels", "Total", "Route", "Mileage", "Driver", ""],
    ["16th November 2026", "85", "106", "21", "£197.20", "£1.05", "£198.25", "359", "85", "DR66445 Jamie Test", "Download"],
    ["Download All"],
  ];
  const transform = tableTransformSchema.parse({
    rename: { "Total Parcels": "Parcels", Parcels: "Parcel pay (£)", Stop: "Stop pay (£)", Total: "Gross earnings" },
    dropRows: ["^Download All$"],
    split: [{ column: "Driver", pattern: "^(DR\\d+)\\s+(.+)$", into: ["Driver ID", "Driver"] }],
  });

  it("renames in one pass (no chaining), splits the driver cell and drops the footer", () => {
    const out = transformTable(payments, transform, values);
    expect(out[0]).toEqual(["Payments"]);
    expect(out[1]).toEqual(["Date", "Stops", "Parcels", "Excess Parcels", "Stop pay (£)", "Parcel pay (£)", "Gross earnings", "Route", "Mileage", "Driver", "", "Driver ID"]);
    expect(out[2]).toEqual(["16th November 2026", "85", "106", "21", "£197.20", "£1.05", "£198.25", "359", "85", "Jamie Test", "Download", "DR66445"]);
    expect(out).toHaveLength(3);
  });

  it("leaves a cell alone when the split pattern does not match", () => {
    const rows = [["A", "B", "Driver"], ["1", "2", "No Code Here"]];
    const out = transformTable(rows, tableTransformSchema.parse({ split: [{ column: "Driver", pattern: "^(DR\\d+)\\s+(.+)$", into: ["Driver ID", "Driver"] }] }), values);
    expect(out[1]).toEqual(["1", "2", "No Code Here", ""]);
  });

  it("joins several tables: repeated headings are dropped, other widths are ignored", () => {
    const rows = [
      ["", "Description", "", "Charge", ""],
      ["Fixed costs", "Management Fee", "", "£11.47 (excl. £2.29 VAT)", ""],
      ["", "Description", "", "Charge", ""],
      ["Variable costs", "Temporary Van Hire", "", "£79.02 (excl. £15.80 VAT)", ""],
      ["only", "three", "cells"],
    ];
    const out = transformTable(
      rows,
      tableTransformSchema.parse({
        headers: ["Category", "Description", "Spacer", "Amount", "Spacer 2"],
        clean: [{ column: "Amount", pattern: "\\s*\\(.*\\)\\s*$" }],
        add: [{ header: "Date", value: "{periodStart:dd/MM/yyyy}" }],
      }),
      values,
    );
    expect(out).toEqual([
      ["Category", "Description", "Spacer", "Amount", "Spacer 2", "Date"],
      ["Fixed costs", "Management Fee", "", "£11.47", "", "09/11/2026"],
      ["Variable costs", "Temporary Van Hire", "", "£79.02", "", "09/11/2026"],
    ]);
  });

  it("says so when the map names the wrong number of columns or a missing column", () => {
    const rows = [["A", "B", "C"], ["1", "2", "3"]];
    expect(() => transformTable(rows, tableTransformSchema.parse({ headers: ["x"] }), values)).toThrow(/3 columns/);
    expect(() => transformTable(rows, tableTransformSchema.parse({ clean: [{ column: "Nope", pattern: "x" }] }), values)).toThrow(/Nope/);
  });
});

describe("the DPD portal map", () => {
  const map = portalMapSchema.parse(JSON.parse(readFileSync("docs/dpd-portal-map.json", "utf8")));

  it("passes the portal map schema and covers Payments and Charges", () => {
    expect(map.reports.map((r) => [r.id, r.kind])).toEqual([["payments", "earnings"], ["charges", "expenses"]]);
  });

  it("turns a Payments table into earnings rows the importer accepts", async () => {
    const payments = map.reports[0]!;
    if (payments.collect.mode !== "table") throw new Error("expected a table report");
    const raw = [
      ["Payments"],
      ["Date", "Stops", "Total Parcels", "Excess Parcels", "Stop", "Parcels", "Total", "Route", "Mileage", "Driver", ""],
      ["16th November 2026", "85", "106", "21", "£197.20", "£1.05", "£198.25", "359", "85", "DR66445 Jamie Test", "Download"],
      ["14th November 2026", "88", "101", "13", "£202.40", "£0.65", "£203.05", "656", "94", "DR08336 Alex Sample", "Download"],
      ["Download All"],
    ];
    const rows = transformTable(raw, payments.collect.transform, values);
    const csv = ["Franchise: FD10001,Report date: 16/11/2026", ...rows.map((r) => r.join(","))].join("\r\n");
    const parsed = parseDocument(await extractDocument("payments.csv", new Uint8Array(Buffer.from(csv, "utf8"))));
    expect(parsed.documentType).toBe("earnings_report");
    expect(parsed.earnings).toHaveLength(2);
    expect(parsed.earnings[0]).toMatchObject({ driverName: "Jamie Test", driverRef: "DR66445", date: "2026-11-16", route: "359", stops: 85, parcels: 106, gross: 19825 });
    expect(parsed.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("turns a Charges table into dated expense rows, excluding VAT as the portal states it", async () => {
    const charges = map.reports[1]!;
    if (charges.collect.mode !== "table") throw new Error("expected a table report");
    const raw = [
      ["", "Description", "", "Charge", ""],
      ["Fixed costs", "Management Fee", "", "£11.47 (excl. £2.29 VAT)", ""],
      ["", "Description", "", "Charge", ""],
      ["Variable costs", "Temporary Van Hire", "", "£79.02 (excl. £15.80 VAT)", ""],
    ];
    const rows = transformTable(raw, charges.collect.transform, values);
    const csv = ["Franchise: FD10001,Report date: 16/11/2026", ...rows.map((r) => r.join(","))].join("\r\n");
    const parsed = parseDocument(await extractDocument("charges.csv", new Uint8Array(Buffer.from(csv, "utf8"))));
    expect(parsed.documentType).toBe("expense_report");
    expect(parsed.expenses.map((e) => [e.date, e.description, e.amount])).toEqual([
      ["2026-11-09", "Management Fee", 1147],
      ["2026-11-09", "Temporary Van Hire", 7902],
    ]);
  });
});
