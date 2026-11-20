import { describe, expect, it } from "vitest";
import { dayInARowByDate, lookBackDays, priceDay, wageForDriver, type DayRate } from "@/lib/finance/wages";

// Oakley: £120 a day, £1 a stop over 110 stops.
const oakley: DayRate = { driverId: "oakley", dayRate: 12000, effectiveFrom: "2026-01-01", bonusAfterStops: 110, bonusPerStop: 100 };
// Jamie: £120 a day, £1 a stop over 105, and £125 a day from the sixth day in a row.
const jamie: DayRate = { driverId: "jamie", dayRate: 12000, effectiveFrom: "2026-01-01", bonusAfterStops: 105, bonusPerStop: 100, streakAfterDays: 5, streakDayRate: 12500 };

const week = (start: number, n: number) => Array.from({ length: n }, (_, i) => `2026-11-${String(start + i).padStart(2, "0")}`);

describe("extra pay per stop", () => {
  it("pays the day rate plus the extra for each stop over the threshold (120 stops on a £120 day with £1 over 110 pays £130)", () => {
    const d = priceDay("2026-11-02", oakley, 120, 1)!;
    expect(d).toMatchObject({ base: 12000, extra: 1000, extraStops: 10, pay: 13000, runRate: false });
  });

  it("pays only the day rate at or under the threshold", () => {
    expect(priceDay("2026-11-02", oakley, 110, 1)!.pay).toBe(12000);
    expect(priceDay("2026-11-02", oakley, 40, 1)!.extra).toBe(0);
  });

  it("cannot price a day with no stop count when the rate has extra pay per stop, and says so rather than guessing", () => {
    expect(priceDay("2026-11-02", oakley, null, 1)).toBeNull();
    const w = wageForDriver("oakley", ["2026-11-02"], [oakley], new Map([["2026-11-02", null]]));
    expect(w.complete).toBe(false);
    expect(w.missingDates).toEqual(["2026-11-02"]);
  });

  it("does not need a stop count for a plain day rate", () => {
    const plain: DayRate = { driverId: "p", dayRate: 12000, effectiveFrom: "2026-01-01" };
    expect(priceDay("2026-11-02", plain, null, 1)!.pay).toBe(12000);
  });
});

describe("days in a row", () => {
  it("counts the days in a row from one, and starts again after a gap", () => {
    const m = dayInARowByDate(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06", "2026-11-07"]);
    expect([...m.values()]).toEqual([1, 2, 3, 1, 2]);
  });

  it("carries a run on from the days worked before the period", () => {
    const m = dayInARowByDate(["2026-11-03", "2026-11-04"], ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(m.get("2026-11-03")).toBe(5);
    expect(m.get("2026-11-04")).toBe(6);
  });

  it("pays the first five days at the day rate and the sixth and seventh at the days-in-a-row rate, with extra stops on top (the owner's example)", () => {
    const dates = week(2, 7);
    const stops = new Map(dates.map((d) => [d, 120] as const));
    const w = wageForDriver("jamie", dates, [jamie], stops);
    // Every day has 120 stops: 15 over 105 = £15 extra. Days 1-5: £120 + £15. Days 6-7: £125 + £15.
    expect(w.wage).toBe(5 * (12000 + 1500) + 2 * (12500 + 1500));
    expect(w.complete).toBe(true);
    expect(priceDay(dates[4]!, jamie, 120, 5)!.runRate).toBe(false);
    expect(priceDay(dates[5]!, jamie, 120, 6)).toMatchObject({ runRate: true, base: 12500, pay: 14000 });
  });

  it("does not pay the days-in-a-row rate to a driver who worked five days with a gap", () => {
    const dates = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"];
    const w = wageForDriver("jamie", dates, [jamie], new Map(dates.map((d) => [d, 100] as const)));
    expect(w.wage).toBe(7 * 12000); // no run reaches a sixth day, and 100 stops is under 105
  });

  it("counts a run that crosses into the period from the week before", () => {
    const before = ["2026-10-28", "2026-10-29", "2026-10-30"];
    const dates = ["2026-10-31", "2026-11-01", "2026-11-02"]; // days 4, 5, 6
    const stops = new Map(dates.map((d) => [d, 100] as const));
    expect(wageForDriver("jamie", dates, [jamie], stops, before).wage).toBe(12000 + 12000 + 12500);
    expect(wageForDriver("jamie", dates, [jamie], stops).wage).toBe(3 * 12000); // without the look-back the run is not seen
  });

  it("allows a days-in-a-row rate that is lower than the day rate, as entered", () => {
    const kieran: DayRate = { driverId: "k", dayRate: 12500, effectiveFrom: "2026-01-01", streakAfterDays: 5, streakDayRate: 12000 };
    expect(priceDay("2026-11-07", kieran, 90, 6)!.pay).toBe(12000);
  });
});

describe("rates and basis", () => {
  it("leaves a per-stop rate alone: the extras only belong to day rates", () => {
    const perStop: DayRate = { driverId: "s", dayRate: 150, effectiveFrom: "2026-01-01", basis: "stop", bonusAfterStops: 10, bonusPerStop: 100, streakAfterDays: 1, streakDayRate: 999 };
    expect(priceDay("2026-11-02", perStop, 100, 3)).toMatchObject({ pay: 15000, extra: 0, runRate: false });
  });

  it("uses the rate in force on each day, so a later change never moves past pay", () => {
    const later: DayRate = { ...oakley, dayRate: 13000, effectiveFrom: "2026-12-01" };
    const stops = new Map([["2026-11-02", 120], ["2026-12-02", 120]] as const);
    const w = wageForDriver("oakley", ["2026-11-02", "2026-12-02"], [oakley, later], stops);
    expect(w.wage).toBe(13000 + 14000);
  });

  it("reads back only as far as the longest days-in-a-row rule needs", () => {
    expect(lookBackDays([jamie, oakley])).toBe(5);
    expect(lookBackDays([oakley])).toBe(0);
  });
});
