/**
 * exceljs is pinned to a patched uuid through package.json "overrides". This checks the spreadsheet path still works
 * end to end, including the part of exceljs that calls uuid (data-bar conditional formatting).
 */
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { extractDocument } from "@/lib/ingest/extract";
import { parseDocument } from "@/lib/ingest/parse";

describe("spreadsheet uploads with the patched uuid", () => {
  it("writes and reads back an .xlsx charges sheet", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Charges");
    ws.addRow(["Franchise: FD10001", "Report date: 09/11/2026"]);
    ws.addRow(["Category", "Description", "Amount", "VAT", "Date"]);
    ws.addRow(["Fixed costs", "Management Fee", "£15.00", "3.00", "09/11/2026"]);
    ws.addConditionalFormatting({ ref: "C3:C3", rules: [{ type: "dataBar", priority: 1, cfvo: [{ type: "min" }, { type: "max" }] } as ExcelJS.ConditionalFormattingRule] });
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const doc = parseDocument(await extractDocument("charges_FD10001_2026-11-09.xlsx", bytes));
    expect(doc.documentType).toBe("expense_report");
    expect(doc.expenses.map((e) => [e.description, e.amount, e.vat])).toEqual([["Management Fee", 1500, 300]]);
  });
});
