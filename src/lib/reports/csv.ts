import { toDb, type Pence } from "@/lib/money";

/** Builds a CSV file. Cells that could be read as spreadsheet formulas are neutralised. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined): string => {
    if (value == null) return "";
    let text = String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Money as a plain decimal for spreadsheets (no currency symbol). */
export function csvMoney(pence: Pence | null | undefined): string {
  return pence == null ? "" : toDb(pence);
}
