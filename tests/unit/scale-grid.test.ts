import { describe, expect, it } from "vitest";
import { gridRate, type ScaleGrid } from "@/lib/finance/scale-grid";

// A small slice of the printed Micro scale (rows 100-105, columns 10-20).
const grid: ScaleGrid = {
  name: "Electric Vehicle Sliding Scale - Micro",
  stopRows: [60, 65, 100, 105, 200],
  mileCols: [10, 20, 90, 100, 160],
  values: [
    [1.57, 1.58, 1.6, 1.61, 1.68],
    [1.53, 1.55, 1.58, 1.59, 1.64],
    [1.37, 1.38, 1.41, 1.42, 1.44],
    [1.36, 1.36, 1.4, 1.41, 1.42],
    [1.25, 1.25, 1.28, 1.29, 1.32],
  ],
};

describe("DPD sliding-scale grid", () => {
  it("rounds stops and miles down to the nearest printed point, as DPD does", () => {
    // 104 stops uses the 100 row; 91 miles uses the 90 column: 1.41 from the printed grid.
    expect(gridRate(grid, 104, 91)).toMatchObject({ rate: 1.41, beyondScale: false, stopRow: 100, mileCol: 90 });
  });

  it("uses the exact printed value, with no further rounding", () => {
    expect(gridRate(grid, 65, 10)?.rate).toBe(1.53);
    expect(gridRate(grid, 60, 20)?.rate).toBe(1.58);
  });

  it("returns null below the bottom row or the first column (not on the scale)", () => {
    expect(gridRate(grid, 59, 20)).toBeNull();
    expect(gridRate(grid, 60, 9)).toBeNull();
    expect(gridRate(grid, 60, null)).toBeNull();
    expect(gridRate(grid, 0, 20)).toBeNull();
  });

  it("uses the top row or column above the printed scale, and says it is a guide only", () => {
    expect(gridRate(grid, 240, 20)).toMatchObject({ rate: 1.25, beyondScale: true, stopRow: 200 });
    expect(gridRate(grid, 100, 300)).toMatchObject({ rate: 1.44, beyondScale: true, mileCol: 160 });
  });
});
