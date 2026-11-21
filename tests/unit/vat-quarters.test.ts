import { describe, expect, it } from "vitest";
import { currentQuarterStart, quarterFrom, recentQuarters } from "@/lib/reports/vat";

describe("VAT quarters", () => {
  it("starts a calendar quarter in January, April, July or October", () => {
    expect(currentQuarterStart("2026-11-21")).toBe("2026-10");
    expect(currentQuarterStart("2026-02-01")).toBe("2026-01");
    expect(currentQuarterStart("2026-07-31")).toBe("2026-07");
  });

  it("covers the whole quarter, first day to last day", () => {
    const q = quarterFrom("2026-07");
    expect(q).toMatchObject({ from: "2026-07-01", to: "2026-09-30", label: "Jul to Sep 2026" });
  });

  it("lists the last four completed quarters, most recent first", () => {
    const starts = recentQuarters("2026-11-21").map((q) => q.start);
    expect(starts).toEqual(["2026-07", "2026-04", "2026-01", "2025-10"]);
  });
});
