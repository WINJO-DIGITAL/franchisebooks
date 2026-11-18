import { describe, expect, it } from "vitest";
import { normaliseFuel, parseScaleRows } from "@/lib/finance/sliding-scale";

describe("reading pasted sliding scale rows", () => {
  it("reads comma-separated rows, open-ended bands and the rate to four decimals", () => {
    const { rows, errors } = parseScaleRows("Van, Large, Diesel, 0, 79, 0, 99, 2.15\nVan, Large, Diesel, 80, , , , 2.3");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { vehicleType: "Van", vehicleSize: "Large", fuelType: "diesel", stopsFrom: 0, stopsTo: 79, milesFrom: 0, milesTo: 99, rate: "2.1500" },
      { vehicleType: "Van", vehicleSize: "Large", fuelType: "diesel", stopsFrom: 80, stopsTo: null, milesFrom: null, milesTo: null, rate: "2.3000" },
    ]);
  });

  it("reads tab-separated rows pasted from a spreadsheet and skips a heading line", () => {
    const text = "Vehicle\tSize\tFuel\tStops from\tStops to\tMiles from\tMiles to\tRate\nVan\tSmall\tElectric\t0\t60\t\t\t£2.45";
    const { rows, errors } = parseScaleRows(text);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vehicleSize: "Small", fuelType: "electric", stopsFrom: 0, stopsTo: 60, rate: "2.4500" });
  });

  it("saves nothing if any line has a problem, and says which", () => {
    const { rows, errors } = parseScaleRows("Van, Large, Diesel, 0, 79, , , 2.15\nVan, Large, Diesel, ten, , , , 2.30\nVan, Large, Diesel, 90, 80, , , 2.30\nVan, Large");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/^Line 2:.*stops from/);
    expect(errors[1]).toMatch(/^Line 3:.*below/);
    expect(errors[2]).toMatch(/^Line 4: expected 8 columns/);
  });

  it("rejects a rate that is not a sensible per-stop amount", () => {
    expect(parseScaleRows("Van, , diesel, 0, , , , 250").errors[0]).toMatch(/rate/);
    expect(parseScaleRows("Van, , diesel, 0, , , , abc").errors[0]).toMatch(/rate/);
  });

  it("treats a blank fuel as diesel and anything unfamiliar as other", () => {
    expect(normaliseFuel("")).toBe("diesel");
    expect(normaliseFuel("EV")).toBe("electric");
    expect(normaliseFuel("Hybrid")).toBe("other");
  });
});

import { checkStopRates, expectedStopRate, type ScaleBand, type VehicleSpec } from "@/lib/finance/sliding-scale";

const van: VehicleSpec = { vehicleType: "Van", vehicleSize: "Large", fuelType: "diesel" };
const bands: ScaleBand[] = [
  { vehicleType: "Van", vehicleSize: "Large", fuelType: "diesel", stopsFrom: 0, stopsTo: 79, milesFrom: null, milesTo: null, rate: 2.15 },
  { vehicleType: "Van", vehicleSize: "Large", fuelType: "diesel", stopsFrom: 80, stopsTo: 99, milesFrom: 0, milesTo: 99, rate: 2.25 },
  { vehicleType: "Van", vehicleSize: "Large", fuelType: "diesel", stopsFrom: 80, stopsTo: 99, milesFrom: 100, milesTo: null, rate: 2.35 },
  { vehicleType: "Van", vehicleSize: "Large", fuelType: "electric", stopsFrom: 0, stopsTo: null, milesFrom: null, milesTo: null, rate: 2.6 },
];

describe("expected stop rate from the scale", () => {
  it("picks the band for the vehicle, the stops and (where the band has them) the miles", () => {
    expect(expectedStopRate(bands, van, 60, null)).toBe(2.15);
    expect(expectedStopRate(bands, van, 85, 90)).toBe(2.25);
    expect(expectedStopRate(bands, van, 85, 120)).toBe(2.35);
  });

  it("matches fuel and ignores case in names", () => {
    expect(expectedStopRate(bands, { vehicleType: "van", vehicleSize: "large", fuelType: "electric" }, 200, null)).toBe(2.6);
  });

  it("gives nothing when miles are needed but not known, or no band fits, or more than one fits", () => {
    expect(expectedStopRate(bands, van, 85, null)).toBeNull();
    expect(expectedStopRate(bands, van, 150, 50)).toBeNull();
    expect(expectedStopRate([bands[0]!, { ...bands[0]!, rate: 9 }], van, 10, null)).toBeNull();
    expect(expectedStopRate(bands, { ...van, vehicleType: "Car" }, 10, null)).toBeNull();
  });
});

describe("checking stop rates against the scale", () => {
  it("counts days that agree and lists the ones that differ, ignoring pennies of rounding", () => {
    const result = checkStopRates(
      [
        { date: "2026-11-02", stops: 60, miles: null, stopPayPence: 12900 }, // 2.15 exactly
        { date: "2026-11-03", stops: 60, miles: null, stopPayPence: 12901 }, // within tolerance
        { date: "2026-11-04", stops: 60, miles: null, stopPayPence: 13800 }, // 2.30, too high
        { date: "2026-11-05", stops: 85, miles: null, stopPayPence: 19125 }, // needs miles
        { date: "2026-11-06", stops: null, miles: null, stopPayPence: 5000 },
      ],
      bands,
      van,
    );
    expect(result.agreed).toBe(2);
    expect(result.differs).toEqual([{ date: "2026-11-04", stops: 60, expected: 2.15, actual: 2.3 }]);
    expect(result.notChecked).toBe(2);
  });
});
