/**
 * Money handling.
 *
 * All monetary amounts are held as whole pence in a JavaScript integer
 * (`Pence`). Nothing in the application adds, subtracts or compares pounds as
 * floating-point numbers. Values enter through `parseMoney` / `fromDb` and
 * leave through `toDb` / `formatGBP`.
 */

export type Pence = number;

const MAX_SAFE_PENCE = 9_000_000_000_00; // £9bn — far above anything this system handles

function assertPence(value: number): Pence {
  if (!Number.isInteger(value) || Math.abs(value) > MAX_SAFE_PENCE) {
    throw new RangeError(`Not a valid pence amount: ${value}`);
  }
  return value === 0 ? 0 : value; // normalise -0
}

/**
 * Parses money text exactly as it might appear in a report.
 * Accepts "£1,234.56", "1234.5", "-12.50", "(12.50)", "12.50-", "12.50 CR".
 * Returns null when the text is not unambiguously a money amount
 * (for example more than two decimal places) — callers must treat that as
 * "could not read", never as zero.
 */
export function parseMoney(input: string | null | undefined): Pence | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (s === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (/\bCR$/i.test(s)) {
    negative = !negative;
    s = s.replace(/\s*CR$/i, "");
  }
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1).trim();
  }
  s = s.replace(/^(GBP|£)\s*/i, "").replace(/\s*(GBP|£)$/i, "");
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(/^(GBP|£)\s*/i, "");

  // Thousands separators must be well-formed if present.
  if (s.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) return null;
  const pounds = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const pence = Number(pounds) * 100 + Number(fraction);
  if (!Number.isSafeInteger(pence) || pence > MAX_SAFE_PENCE) return null;
  return assertPence(negative ? -pence : pence);
}

/** Converts a Postgres numeric(…,2) value (delivered as number or string) to pence. */
export function fromDb(value: number | string | null | undefined): Pence {
  if (value == null) return 0;
  if (typeof value === "string") {
    const parsed = parseMoney(value);
    if (parsed == null) throw new RangeError(`Unexpected money value from database: ${value}`);
    return parsed;
  }
  if (!Number.isFinite(value)) throw new RangeError(`Unexpected money value from database: ${value}`);
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  // A numeric(…,2) always lands within floating-point noise of a whole number of pence.
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new RangeError(`Money value has more than two decimal places: ${value}`);
  }
  return assertPence(rounded);
}

/** Like fromDb but preserves null (for optional columns such as net earnings). */
export function fromDbNullable(value: number | string | null | undefined): Pence | null {
  return value == null ? null : fromDb(value);
}

/** Exact decimal string for the database, e.g. -1250 → "-12.50". */
export function toDb(pence: Pence): string {
  assertPence(pence);
  const abs = Math.abs(pence);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return pence < 0 ? `-${text}` : text;
}

export interface FormatOptions {
  /** Show an explicit "+" on positive amounts (for adjustments). */
  signed?: boolean;
  /** Drop ".00" on whole pounds (for large headline figures). */
  compact?: boolean;
}

/** UK currency formatting: £1,234.56, −£12.50. */
export function formatGBP(pence: Pence | null | undefined, options: FormatOptions = {}): string {
  if (pence == null) return "—";
  assertPence(pence);
  const abs = Math.abs(pence);
  const pounds = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = String(abs % 100).padStart(2, "0");
  const body = options.compact && fraction === "00" ? `£${pounds}` : `£${pounds}.${fraction}`;
  if (pence < 0) return `−${body}`;
  if (options.signed && pence > 0) return `+${body}`;
  return body;
}

export function sumPence(values: Iterable<Pence>): Pence {
  let total = 0;
  for (const v of values) total += v;
  return assertPence(total);
}

/** Integer division rounding half away from zero. */
function divRound(numerator: number, denominator: number): number {
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/** Average amount per unit (per parcel, per stop, per day), rounded to the nearest penny. */
export function perUnit(total: Pence, units: number): Pence | null {
  if (!Number.isInteger(units) || units <= 0) return null;
  return assertPence(divRound(total, units));
}

/** part ÷ whole as a percentage with one decimal place (e.g. 12.3). Null when whole is zero. */
export function percentOf(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return divRound(part * 1000, whole) / 10;
}

/** Percentage change from `from` to `to`, one decimal place. Null when `from` is zero. */
export function percentChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return divRound((to - from) * 1000, Math.abs(from)) / 10;
}

/**
 * Splits `total` across weighted shares so that the parts add up to exactly
 * `total` (largest-remainder method). Used when allocating revenue.
 */
export function allocateProportionally(total: Pence, weights: number[]): Pence[] {
  assertPence(total);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (weightSum <= 0 || weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new RangeError("Weights must be non-negative with a positive total");
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = weights.map((w) => (abs * w) / weightSum);
  const base = exact.map((x) => Math.floor(x + 1e-9));
  let remainder = abs - base.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    base[i] = (base[i] ?? 0) + 1;
    remainder -= 1;
  }
  return base.map((b) => assertPence(sign * b));
}

/**
 * Parses a unit rate such as pay-per-parcel ("0.875", "£1.10") to a decimal
 * string with up to four decimal places. Null when it cannot be read.
 */
export function parseRate(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/^(GBP|£)\s*/i, "").replace(/,/g, "");
  if (s.endsWith("p") && /^\d+(\.\d{1,2})?p$/.test(s)) {
    // "87.5p" → pounds
    const penceText = s.slice(0, -1);
    const [whole = "0", frac = ""] = penceText.split(".");
    const tenThousandths = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
    return (tenThousandths / 10000).toFixed(4);
  }
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(s);
  if (!match) return null;
  return `${Number(match[1])}.${(match[2] ?? "").padEnd(4, "0")}`;
}

/** rate (decimal string, ≤4dp) × quantity, rounded to the nearest penny. */
export function rateTimes(rate: string | number | null | undefined, quantity: number | null | undefined): Pence | null {
  if (rate == null || quantity == null) return null;
  const text = typeof rate === "number" ? rate.toFixed(4) : rate;
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text.trim());
  if (!match || !Number.isInteger(quantity)) return null;
  const tenThousandths = Number(match[1]) * 10000 + Number((match[2] ?? "").padEnd(4, "0"));
  return assertPence(divRound(tenThousandths * quantity, 100));
}
