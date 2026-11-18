/**
 * DPD's sliding scale: the rate paid per stop depends on the vehicle (type, size, diesel or electric) and on how many
 * stops and miles the day involved. The owner copies the rates from the portal's Sliding Scale page, one row per band.
 * This module reads pasted rows. Pure code: no database, no network.
 *
 * One row per line, columns separated by commas or tabs:
 *   vehicle type, size, fuel, stops from, stops to, miles from, miles to, rate per stop (£)
 * "To" columns may be left blank for "and above". A first line of headings is skipped.
 */

import { parseRate } from "@/lib/money";

export type FuelType = "diesel" | "electric" | "other";

export interface ScaleRateInput {
  vehicleType: string;
  vehicleSize: string | null;
  fuelType: FuelType;
  stopsFrom: number;
  stopsTo: number | null;
  milesFrom: number | null;
  milesTo: number | null;
  /** Pounds per stop, four decimal places ("2.2693"). */
  rate: string;
}

export interface ScaleParseResult {
  rows: ScaleRateInput[];
  /** Plain-English problems, one per line that could not be read. Nothing is saved if any line has a problem. */
  errors: string[];
}

export function normaliseFuel(text: string): FuelType {
  const t = text.trim().toLowerCase();
  if (/^(electric|ev|bev|elec)\b/.test(t)) return "electric";
  if (t === "" || /^diesel\b/.test(t)) return "diesel";
  return "other";
}

function wholeNumber(text: string): number | null | "invalid" {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return "invalid";
  return Number(t);
}

function splitLine(line: string): string[] {
  return (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
}

export function parseScaleRows(text: string): ScaleParseResult {
  const rows: ScaleRateInput[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");

  lines.forEach((line, index) => {
    const cells = splitLine(line);
    const n = index + 1;
    // A heading line: the "stops from" cell is not a number.
    if (index === 0 && cells.length >= 4 && wholeNumber(cells[3] ?? "") === "invalid") return;
    if (cells.length < 8) {
      errors.push(`Line ${n}: expected 8 columns (vehicle, size, fuel, stops from, stops to, miles from, miles to, rate) but found ${cells.length}.`);
      return;
    }
    const [vehicle, size, fuel, stopsFromText, stopsToText, milesFromText, milesToText, rateText] = cells as [string, string, string, string, string, string, string, string];
    const problems: string[] = [];
    if (vehicle === "") problems.push("the vehicle type is empty");
    if (vehicle.length > 80 || size.length > 80) problems.push("a name is too long");
    const stopsFrom = wholeNumber(stopsFromText);
    const stopsTo = wholeNumber(stopsToText);
    const milesFrom = wholeNumber(milesFromText);
    const milesTo = wholeNumber(milesToText);
    if (stopsFrom === null || stopsFrom === "invalid") problems.push(`"stops from" must be a whole number (got "${stopsFromText}")`);
    if (stopsTo === "invalid") problems.push(`"stops to" must be a whole number or blank (got "${stopsToText}")`);
    if (milesFrom === "invalid") problems.push(`"miles from" must be a whole number or blank (got "${milesFromText}")`);
    if (milesTo === "invalid") problems.push(`"miles to" must be a whole number or blank (got "${milesToText}")`);
    if (typeof stopsFrom === "number" && typeof stopsTo === "number" && stopsTo < stopsFrom) problems.push('"stops to" is below "stops from"');
    if (typeof milesFrom === "number" && typeof milesTo === "number" && milesTo < milesFrom) problems.push('"miles to" is below "miles from"');
    const rate = parseRate(rateText);
    if (rate == null || Number(rate) > 100) problems.push(`the rate "${rateText}" is not a sensible £ amount per stop`);

    if (problems.length > 0) {
      errors.push(`Line ${n}: ${problems.join("; ")}.`);
      return;
    }
    rows.push({
      vehicleType: vehicle,
      vehicleSize: size === "" ? null : size,
      fuelType: normaliseFuel(fuel),
      stopsFrom: stopsFrom as number,
      stopsTo: stopsTo as number | null,
      milesFrom: milesFrom as number | null,
      milesTo: milesTo as number | null,
      rate: rate as string,
    });
  });

  return { rows: errors.length > 0 ? [] : rows, errors };
}
