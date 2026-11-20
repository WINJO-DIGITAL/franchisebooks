/**
 * DPD's sliding scale as a grid: the pay per stop for a stop count (rows) and a mileage (columns), exactly as the
 * PDF prints it, in pounds per stop (1.69 is £1.69). Pure code.
 *
 * Lookup rule, as DPD applies it: round DOWN to the nearest row and column. 104 stops uses the 100-stop row; 91 miles
 * uses the 90-mile column. The stop count itself is then multiplied by the rate found, so the pay is always to the penny.
 *
 * Beyond the printed scale (above the top row or column) the top row or column is used as a guide only. Those days are
 * not counted as stated figures.
 */

export interface ScaleGrid {
  name: string;
  /** Stop counts for each row, ascending (for example 60, 65, ... 200). */
  stopRows: number[];
  /** Mileages for each column, ascending (for example 10, 20, ... 160). */
  mileCols: number[];
  /** values[row][col] in pounds per stop. */
  values: number[][];
}

export interface GridRate {
  /** The rate used (pounds per stop). */
  rate: number;
  /** True when the day is above the printed scale, so the rate is a guide only. */
  beyondScale: boolean;
  stopRow: number;
  mileCol: number;
}

/** The largest value in `points` that is at or below `value`, or null when `value` is below them all. */
function roundDown(points: number[], value: number): number | null {
  let found: number | null = null;
  for (const p of points) {
    if (p <= value) found = p;
    else break;
  }
  return found;
}

export function gridRate(grid: ScaleGrid, stops: number, miles: number | null): GridRate | null {
  if (miles == null || stops <= 0) return null;
  const top = grid.stopRows[grid.stopRows.length - 1]!;
  const topMile = grid.mileCols[grid.mileCols.length - 1]!;
  const beyondStops = stops > top;
  const beyondMiles = miles > topMile;
  const stopRow = beyondStops ? top : roundDown(grid.stopRows, stops);
  const mileCol = beyondMiles ? topMile : roundDown(grid.mileCols, miles);
  if (stopRow == null || mileCol == null) return null; // below the bottom row or the first column: not on the scale
  const row = grid.stopRows.indexOf(stopRow);
  const col = grid.mileCols.indexOf(mileCol);
  const rate = grid.values[row]?.[col];
  if (rate == null) return null;
  return { rate, beyondScale: beyondStops || beyondMiles, stopRow, mileCol };
}

/**
 * A scale's effective date written the way the DPD portal shows it (DD/MM/YYYY), whatever the date is. DPD uses 01/01/1970
 * for scales that have no start date, and the app shows that as DPD does rather than hiding it.
 */
export function formatPortalDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}
