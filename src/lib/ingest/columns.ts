/**
 * Column recognition for tabular source documents.
 *
 * Reports are read by matching column headings, not by position, so a report
 * whose columns are re-ordered still imports correctly. The synonym lists are
 * the one place to extend when a real DPD document uses a different heading.
 */

export type DocumentType = "earnings_report" | "fuel_report" | "expense_report" | "unknown";

export type EarningsField =
  | "driver" | "driverRef" | "date" | "route" | "parcels" | "stops" | "payPerParcel" | "payPerStop"
  | "gross" | "deductions" | "additional" | "net"
  | "excessParcels" | "mileage" | "stopPay" | "parcelPay";

export type FuelField =
  | "date" | "time" | "card" | "registration" | "driver" | "supplier" | "description" | "litres"
  | "pricePerLitre" | "net" | "vat" | "total" | "reference";

export type ExpenseField =
  | "date" | "description" | "supplier" | "category" | "amount" | "reference" | "registration" | "driver";

const EARNINGS: Record<EarningsField, string[]> = {
  driver: ["driver", "driver name", "name", "courier", "courier name"],
  driverRef: ["driver id", "driver no", "driver number", "driver ref", "driver reference", "courier id", "driver code"],
  date: ["date", "delivery date", "report date", "work date", "day"],
  route: ["route", "route no", "route number", "round", "route id"],
  parcels: ["parcels", "parcels delivered", "parcel count", "delivered parcels", "pcls", "parcels del", "no of parcels"],
  stops: ["stops", "stops completed", "stop count", "completed stops", "no of stops"],
  payPerParcel: ["pay per parcel", "parcel rate", "rate per parcel", "per parcel", "£/parcel", "£ per parcel"],
  payPerStop: ["pay per stop", "stop rate", "rate per stop", "per stop", "£/stop", "£ per stop"],
  gross: ["gross", "gross earnings", "gross pay", "gross daily earnings", "earnings", "daily earnings", "gross amount"],
  deductions: ["deductions", "deduction", "charges", "less deductions"],
  additional: ["additional", "additional payments", "additional payment", "additions", "bonus", "extras", "other payments"],
  net: ["net", "net earnings", "net pay", "net amount", "total pay", "payable", "net payable"],
  excessParcels: ["excess parcels", "excess parcel", "excess"],
  mileage: ["mileage", "miles"],
  stopPay: ["stop pay", "stop pay £", "stop pay gbp"],
  parcelPay: ["parcel pay", "parcel pay £", "parcel pay gbp"],
};

const FUEL: Record<FuelField, string[]> = {
  date: ["date", "transaction date", "trans date", "purchase date"],
  time: ["time", "transaction time"],
  card: ["card", "card number", "card no", "fuel card", "card ref"],
  registration: ["registration", "reg", "vehicle", "vehicle reg", "vehicle registration", "vrn", "reg no"],
  driver: ["driver", "driver name"],
  supplier: ["site", "supplier", "merchant", "station", "location", "site name"],
  description: ["product", "description", "fuel type", "fuel"],
  litres: ["litres", "liters", "quantity", "qty", "volume", "ltrs"],
  pricePerLitre: ["ppl", "price per litre", "unit price", "pence per litre", "price/litre", "£/litre"],
  net: ["net", "net amount", "net value"],
  vat: ["vat", "vat amount"],
  total: ["total", "total cost", "gross", "gross amount", "amount", "value", "total amount"],
  reference: ["reference", "ref", "transaction id", "transaction ref", "transaction no", "receipt", "receipt no"],
};

const EXPENSE: Record<ExpenseField, string[]> = {
  date: ["date", "expense date", "invoice date", "transaction date"],
  description: ["description", "details", "item", "narrative"],
  supplier: ["supplier", "merchant", "payee", "vendor", "paid to"],
  category: ["category", "type", "expense type", "expense category"],
  amount: ["amount", "total", "cost", "value", "gross", "gross amount", "total amount"],
  reference: ["reference", "ref", "invoice", "invoice no", "invoice number", "receipt", "transaction id"],
  registration: ["registration", "reg", "vehicle", "vehicle reg", "vehicle registration", "vrn"],
  driver: ["driver", "driver name"],
};

export function normaliseHeader(text: string): string {
  return text
    .toLowerCase()
    .replace(/[()\[\]:.#*_]/g, " ")
    .replace(/\bnumber\b/g, "no")
    .replace(/\s+/g, " ")
    .trim();
}

function lookup<F extends string>(table: Record<F, string[]>): Map<string, F> {
  const map = new Map<string, F>();
  for (const field of Object.keys(table) as F[]) {
    for (const synonym of table[field]) map.set(normaliseHeader(synonym), field);
  }
  return map;
}

const EARNINGS_LOOKUP = lookup(EARNINGS);
const FUEL_LOOKUP = lookup(FUEL);
const EXPENSE_LOOKUP = lookup(EXPENSE);
const ANY_HEADER = new Set([...EARNINGS_LOOKUP.keys(), ...FUEL_LOOKUP.keys(), ...EXPENSE_LOOKUP.keys()]);

/** A line is treated as a table header when at least three of its cells are known column headings. */
export function looksLikeHeader(cells: string[]): boolean {
  if (cells.length < 3) return false;
  let known = 0;
  for (const cell of cells) if (ANY_HEADER.has(normaliseHeader(cell))) known++;
  return known >= 3 && known >= cells.length / 2;
}

export interface ColumnMap<F extends string> {
  /** field → column index */
  columns: Partial<Record<F, number>>;
  /** Headings in the document that were not recognised. */
  unknown: string[];
}

function mapWith<F extends string>(table: Map<string, F>, header: string[]): ColumnMap<F> {
  const columns: Partial<Record<F, number>> = {};
  const unknown: string[] = [];
  header.forEach((cell, index) => {
    const field = table.get(normaliseHeader(cell));
    if (field && columns[field] === undefined) columns[field] = index;
    else if (cell.trim() !== "" && !field) unknown.push(cell.trim());
  });
  return { columns, unknown };
}

export const mapEarningsColumns = (header: string[]) => mapWith(EARNINGS_LOOKUP, header);
export const mapFuelColumns = (header: string[]) => mapWith(FUEL_LOOKUP, header);
export const mapExpenseColumns = (header: string[]) => mapWith(EXPENSE_LOOKUP, header);

/**
 * Decides what kind of report a header row belongs to, from the columns that
 * are distinctive for each kind.
 */
export function classifyHeader(header: string[]): DocumentType {
  const e = mapEarningsColumns(header).columns;
  const f = mapFuelColumns(header).columns;
  const x = mapExpenseColumns(header).columns;
  const earningsScore =
    (e.parcels !== undefined ? 2 : 0) + (e.stops !== undefined ? 2 : 0) + (e.payPerParcel !== undefined ? 1 : 0) +
    (e.payPerStop !== undefined ? 1 : 0) + (e.driver !== undefined && (e.gross !== undefined || e.net !== undefined) ? 1 : 0);
  const fuelScore =
    (f.litres !== undefined ? 2 : 0) + (f.pricePerLitre !== undefined ? 2 : 0) + (f.card !== undefined ? 1 : 0) +
    (f.total !== undefined && f.date !== undefined ? 1 : 0);
  const expenseScore =
    (x.category !== undefined ? 2 : 0) + (x.description !== undefined ? 1 : 0) + (x.amount !== undefined && x.date !== undefined ? 1 : 0);

  if (earningsScore >= 3 && earningsScore > fuelScore) return "earnings_report";
  if (fuelScore >= 3) return "fuel_report";
  if (expenseScore >= 3 && x.amount !== undefined && x.date !== undefined) return "expense_report";
  return "unknown";
}

/** True when a row is a totals line rather than data. */
export function isTotalsRow(cells: string[]): boolean {
  const first = cells.find((c) => c.trim() !== "") ?? "";
  return /^(grand\s+|sub\s*-?\s*|report\s+)?totals?\b/i.test(first.trim());
}
