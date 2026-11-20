import { describe, expect, it } from "vitest";
import { vatStatusByPeriod } from "@/lib/finance/vat-status";

const p = (periodStart: string, vatTotal: number | null) => ({ periodStart, vatTotal });

describe("VAT status read from each period's invoice", () => {
  it("says charging when the invoice states VAT, not charging when it states none, unknown when there is no invoice", () => {
    const r = vatStatusByPeriod([p("2026-01-05", 500), p("2026-02-02", 0), p("2026-03-02", null)]);
    expect(r.map((x) => x.status)).toEqual(["charging", "not_charging", "unknown"]);
  });

  it("names a change when VAT first appears after periods without it", () => {
    const r = vatStatusByPeriod([p("2024-09-16", 0), p("2024-10-14", 0), p("2024-11-11", 4200)]);
    expect(r[2]!.change).toBe("became_registered");
    expect(r[0]!.change).toBeNull();
  });

  it("names a change when VAT stops appearing", () => {
    const r = vatStatusByPeriod([p("2026-01-05", 900), p("2026-02-02", 0)]);
    expect(r[1]!.change).toBe("stopped_charging");
  });

  it("does not create a change across a period with no invoice", () => {
    const r = vatStatusByPeriod([p("2026-01-05", 0), p("2026-02-02", null), p("2026-03-02", 700)]);
    expect(r[2]!.change).toBe("became_registered");
    expect(r[1]!.change).toBeNull();
  });

  it("reads periods oldest first whatever order they arrive in", () => {
    const r = vatStatusByPeriod([p("2026-02-02", 700), p("2026-01-05", 0)]);
    expect(r.map((x) => x.periodStart)).toEqual(["2026-01-05", "2026-02-02"]);
    expect(r[1]!.change).toBe("became_registered");
  });

  it("names no change for a franchise that is steady", () => {
    const r = vatStatusByPeriod([p("2026-01-05", 0), p("2026-02-02", 0)]);
    expect(r.every((x) => x.change === null)).toBe(true);
  });
});
