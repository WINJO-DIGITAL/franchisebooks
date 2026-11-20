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

// ── Checking the rate DPD actually paid against the scale ───────────────────────────────────────────

export interface ScaleBand {
  vehicleType: string;
  vehicleSize: string | null;
  fuelType: FuelType;
  stopsFrom: number;
  stopsTo: number | null;
  milesFrom: number | null;
  milesTo: number | null;
  /** Pounds per stop. */
  rate: number;
}

export interface VehicleSpec {
  vehicleType: string;
  vehicleSize: string | null;
  fuelType: FuelType;
}

const same = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

function within(value: number, from: number | null, to: number | null): boolean {
  return (from == null || value >= from) && (to == null || value <= to);
}

/**
 * The per-stop rate the scale gives a day: the band for this vehicle (type, size, fuel) that covers the day's stops and,
 * if the band has mileage limits, its miles. Returns null when no band matches, when a band needs miles the day does not
 * have, or when more than one band matches (so a vague scale never produces a false flag).
 */
export function expectedStopRate(bands: ScaleBand[], vehicle: VehicleSpec, stops: number, miles: number | null): number | null {
  const matches = bands.filter((b) => {
    if (!same(b.vehicleType, vehicle.vehicleType) || b.fuelType !== vehicle.fuelType) return false;
    if (b.vehicleSize != null && !same(b.vehicleSize, vehicle.vehicleSize)) return false;
    if (!within(stops, b.stopsFrom, b.stopsTo)) return false;
    const hasMileLimits = b.milesFrom != null || b.milesTo != null;
    if (hasMileLimits) {
      if (miles == null) return false;
      return within(miles, b.milesFrom, b.milesTo);
    }
    return true;
  });
  return matches.length === 1 ? matches[0]!.rate : null;
}

export interface RateCheckDay {
  date: string;
  stops: number | null;
  miles: number | null;
  /** Pence paid for the day's stops. */
  stopPayPence: number | null;
}

export interface RateCheckResult {
  /** Days where the actual rate differs from the scale by more than the tolerance. */
  differs: { date: string; stops: number; expected: number; actual: number }[];
  /** Days that were compared and agreed. */
  agreed: number;
  /** Days that could not be compared (no stops, no stop pay, or no single matching band). */
  notChecked: number;
}

/** Compares each day's actual per-stop rate (stop pay ÷ stops) with the scale. `tolerance` is in pounds per stop. */
export function checkStopRates(days: RateCheckDay[], bands: ScaleBand[], vehicle: VehicleSpec, tolerance = 0.02): RateCheckResult {
  const out: RateCheckResult = { differs: [], agreed: 0, notChecked: 0 };
  for (const d of days) {
    if (d.stops == null || d.stops <= 0 || d.stopPayPence == null) { out.notChecked += 1; continue; }
    const expected = expectedStopRate(bands, vehicle, d.stops, d.miles);
    if (expected == null) { out.notChecked += 1; continue; }
    const actual = d.stopPayPence / 100 / d.stops;
    // A tiny allowance for floating-point maths, so a difference of exactly the tolerance counts as agreeing.
    if (Math.abs(actual - expected) > tolerance + 1e-9) out.differs.push({ date: d.date, stops: d.stops, expected, actual });
    else out.agreed += 1;
  }
  return out;
}
