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
