import { describe, expect, it } from "vitest";
import { formatPortalDate, gridRate } from "@/lib/finance/scale-grid";
import { buildDiscrepancyReport } from "@/lib/finance/discrepancy";
import { isScaleKey, listScales, loadScaleGrid, scaleSummary } from "@/lib/finance/scale-library";

const NO_VEHICLE = { vehicleType: "", vehicleSize: null, fuelType: "diesel" as const };

describe("the saved DPD sliding scales", () => {
  it("lists every scale once, in the order the DPD portal lists them, each with an ISO effective date", async () => {
    const scales = await listScales();
    expect(scales).toHaveLength(33);
    expect(new Set(scales.map((s) => s.key)).size).toBe(33);
    expect(new Set(scales.map((s) => s.name)).size).toBe(33);
    expect(scales.map((s) => s.order)).toEqual(Array.from({ length: 33 }, (_, i) => i + 1));
    expect(scales[0]!.name).toBe("ODF e-Micro");
    expect(scales.at(-1)!.name).toBe("ODW 3.5 Tonne - LSC");
    for (const s of scales) {
      expect(s.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["ODF", "ODW"]).toContain(s.scheme);
      expect(s.name.startsWith(s.scheme)).toBe(true);
    }
  });

  it("holds a whole, ascending grid for each scale", async () => {
    for (const s of await listScales()) {
      const g = await loadScaleGrid(s.key);
      expect(g, s.key).not.toBeNull();
      expect(g!.values).toHaveLength(g!.stopRows.length);
      for (const row of g!.values) {
        expect(row).toHaveLength(g!.mileCols.length);
        for (const v of row) expect(typeof v).toBe("number");
      }
      expect([...g!.stopRows].sort((a, b) => a - b)).toEqual(g!.stopRows);
      expect([...g!.mileCols].sort((a, b) => a - b)).toEqual(g!.mileCols);
    }
  });

  it("only accepts the keys of saved scales, so a key cannot reach another file", async () => {
    expect(await isScaleKey("electric-micro")).toBe(true);
    for (const bad of ["", "../package", "electric-micro.json", "ELECTRIC-MICRO", "no-such-scale", null, undefined]) expect(await isScaleKey(bad)).toBe(false);
    expect(await loadScaleGrid("../package")).toBeNull();
    expect((await scaleSummary("electric-micro"))?.name).toBe("ODF e-Micro");
  });

  it("checks a route against the chosen scale to the penny, rounding stops and miles down", async () => {
    const grid = (await loadScaleGrid("electric-micro"))!;
    const found = gridRate(grid, 104, 91)!;
    expect(found.stopRow).toBe(100);
    expect(found.mileCol).toBe(90);
    const paid = Math.round(found.rate * 100) * 104;
    const agrees = buildDiscrepancyReport([{ date: "2026-11-02", stops: 104, miles: 91, stopPayPence: paid }], [], NO_VEHICLE, grid);
    expect(agrees.totals.agreedDays).toBe(1);
    const short = buildDiscrepancyReport([{ date: "2026-11-02", stops: 104, miles: 91, stopPayPence: paid - 104 }], [], NO_VEHICLE, grid);
    expect(short.totals.underpaidDays).toBe(1);
    expect(short.totals.underpaidPence).toBe(-104);
  });
});

describe("a scale's date as the DPD portal shows it", () => {
  it("writes DD/MM/YYYY, including DPD's 01/01/1970 for scales with no start date", () => {
    expect(formatPortalDate("2026-01-05")).toBe("05/01/2026");
    expect(formatPortalDate("1970-01-01")).toBe("01/01/1970");
    expect(formatPortalDate("")).toBe("—");
    expect(formatPortalDate(null)).toBe("—");
  });
});
