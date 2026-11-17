import { describe, expect, it } from "vitest";
import { driverKeyFor, matchCategory, matchDriver, matchDriverByVehicle, matchFranchise, type RosterDriver } from "@/lib/ingest/match";

const roster: RosterDriver[] = [
  { id: "d1", displayName: "Alex Example", dpdRef: "T1001", aliases: ["A. Example"], assignments: [{ franchiseId: "f1", startDate: "2026-01-01", endDate: null, vehicleRegistration: "AB12CDE" }] },
  { id: "d2", displayName: "Sam Twin", dpdRef: null, aliases: [], assignments: [{ franchiseId: "f1", startDate: "2026-01-01", endDate: "2026-06-30", vehicleRegistration: "XY21ZZZ" }] },
  { id: "d3", displayName: "Sam Twin", dpdRef: null, aliases: [], assignments: [{ franchiseId: "f2", startDate: "2026-01-01", endDate: null, vehicleRegistration: "XY21ZZZ" }] },
];

describe("driver matching", () => {
  it("prefers the DPD driver reference", () => {
    expect(matchDriver({ ref: "t1001", name: "Somebody Else", franchiseId: "f1", date: "2026-11-14" }, roster)).toMatchObject({ driverId: "d1", method: "dpd_ref" });
  });
  it("matches names regardless of case, punctuation and order", () => {
    expect(matchDriver({ ref: null, name: "EXAMPLE, Alex", franchiseId: "f1", date: "2026-11-14" }, roster).driverId).toBe("d1");
    expect(matchDriver({ ref: null, name: "a. example", franchiseId: "f1", date: "2026-11-14" }, roster).driverId).toBe("d1");
  });
  it("treats a route's FD number written before a name as the same person", () => {
    expect(matchDriver({ ref: null, name: "FD46578 Alex Example", franchiseId: "f1", date: "2026-11-14" }, roster)).toMatchObject({ driverId: "d1", method: "name" });
    expect(matchDriver({ ref: null, name: "FD 46578 EXAMPLE, Alex", franchiseId: "f1", date: "2026-11-14" }, roster).driverId).toBe("d1");
    // the stored row key is unchanged, so a day already imported is not mistaken for a new one
    expect(driverKeyFor(null, "FD46578 Alex Example")).not.toBe(driverKeyFor(null, "Alex Example"));
  });
  it("uses franchise and date to tell apart two drivers with the same name", () => {
    expect(matchDriver({ ref: null, name: "Sam Twin", franchiseId: "f2", date: "2026-11-14" }, roster).driverId).toBe("d3");
    expect(matchDriver({ ref: null, name: "Sam Twin", franchiseId: "f1", date: "2026-03-01" }, roster).driverId).toBe("d2");
  });
  it("leaves the row unmatched rather than guess between namesakes", () => {
    expect(matchDriver({ ref: null, name: "Sam Twin", franchiseId: null, date: "2026-03-01" }, roster)).toEqual({ driverId: null, method: null, ambiguous: true });
  });
  it("leaves unknown names unmatched", () => {
    expect(matchDriver({ ref: null, name: "New Person", franchiseId: "f1", date: "2026-11-14" }, roster)).toEqual({ driverId: null, method: null, ambiguous: false });
  });
  it("keeps a stable key for the name as the source wrote it", () => {
    expect(driverKeyFor("T1001", "Alex Example")).toBe("ref:t1001");
    expect(driverKeyFor(null, "EXAMPLE, Alex")).toBe(driverKeyFor(null, "Alex  Example"));
  });
});

describe("vehicle matching", () => {
  it("attributes by vehicle only when exactly one driver had it that day", () => {
    expect(matchDriverByVehicle("ab12 cde", "2026-11-14", roster).driverId).toBe("d1");
    expect(matchDriverByVehicle("XY21ZZZ", "2026-03-01", roster)).toMatchObject({ driverId: null, ambiguous: true });
    expect(matchDriverByVehicle("XY21ZZZ", "2026-11-14", roster).driverId).toBe("d3");
    expect(matchDriverByVehicle("ZZ99ZZZ", "2026-11-14", roster).driverId).toBeNull();
    expect(matchDriverByVehicle(null, "2026-11-14", roster).driverId).toBeNull();
  });
});

describe("franchise matching", () => {
  const franchises = [{ id: "f1", fdNumber: "FD-TEST-1" }, { id: "f2", fdNumber: "FD-TEST-12" }];
  it("finds the FD number in the document or file name", () => {
    expect(matchFranchise("Franchise: FD-TEST-1\nReport date", "x.pdf", franchises)).toEqual({ franchiseId: "f1", ambiguous: false });
    expect(matchFranchise("nothing here", "earnings_FD-TEST-12_2026.pdf", franchises)).toEqual({ franchiseId: "f2", ambiguous: false });
    expect(matchFranchise("Franchise fd test 12", "x.pdf", franchises).franchiseId).toBe("f2");
  });
  it("does not confuse one FD number with a longer one", () => {
    expect(matchFranchise("Franchise: FD-TEST-12", "x.pdf", franchises).franchiseId).toBe("f2");
  });
  it("returns nothing when no or several franchises are named", () => {
    expect(matchFranchise("no id", "x.pdf", franchises)).toEqual({ franchiseId: null, ambiguous: false });
    expect(matchFranchise("FD-TEST-1 and FD-TEST-12", "x.pdf", franchises)).toEqual({ franchiseId: null, ambiguous: true });
  });
});

describe("expense categories", () => {
  const categories = ["Fuel", "Tyres", "Repairs", "Vehicle maintenance", "Insurance", "Vehicle hire", "Parking", "Equipment", "Other operating expenses"]
    .map((name, i) => ({ id: `c${i}`, name }));
  it("uses the stated category, then obvious keywords, then the catch-all", () => {
    expect(matchCategory("tyres", "", categories)?.name).toBe("Tyres");
    expect(matchCategory(null, "MOT and annual service", categories)?.name).toBe("Vehicle maintenance");
    expect(matchCategory(null, "Van rental week 46", categories)?.name).toBe("Vehicle hire");
    expect(matchCategory("Misc", "Coffee for the depot", categories)?.name).toBe("Other operating expenses");
  });
  it("files a charge described as fuel under Fuel even when the portal heading says DPD charges", () => {
    const withDpd = [...categories, { id: "dpd", name: "DPD charges" }];
    expect(matchCategory("DPD charges", "Fuel Usage", withDpd)?.name).toBe("Fuel");
    expect(matchCategory("DPD charges", "Lease Cost", withDpd)?.name).toBe("DPD charges");
    expect(matchCategory("DPD charges", "Fixed Vehicle Mileage", withDpd)?.name).toBe("DPD charges");
  });
});
