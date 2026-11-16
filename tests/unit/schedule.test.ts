import { describe, expect, it } from "vitest";
import { decideSchedule, type ScheduleSettings } from "@/lib/jobs/schedule";

const base: ScheduleSettings = { syncEnabled: true, syncTimeLocal: "20:30", syncTimezone: "Europe/London" };

describe("decideSchedule", () => {
  it("is not due before the configured UK time", () => {
    const d = decideSchedule(base, new Date("2026-11-14T20:29:00Z")); // GMT: 20:29 UK
    expect(d.syncDue).toBe(false);
    expect(d.reportDate).toBe("2026-11-14");
  });

  it("is due from the configured UK time (winter, GMT)", () => {
    expect(decideSchedule(base, new Date("2026-11-14T20:30:00Z")).syncDue).toBe(true);
    expect(decideSchedule(base, new Date("2026-11-14T23:59:00Z")).syncDue).toBe(true);
  });

  it("follows British Summer Time: 20:30 UK is 19:30 UTC in July", () => {
    expect(decideSchedule(base, new Date("2026-07-14T19:29:00Z")).syncDue).toBe(false);
    expect(decideSchedule(base, new Date("2026-07-14T19:30:00Z")).syncDue).toBe(true);
  });

  it("uses the UK calendar day, not the UTC day, around midnight in summer", () => {
    // 23:30 UTC on 14 July is 00:30 BST on 15 July.
    const d = decideSchedule(base, new Date("2026-07-14T23:30:00Z"));
    expect(d.reportDate).toBe("2026-07-15");
    expect(d.syncDue).toBe(false); // 00:30 is before 20:30
  });

  it("handles the clocks going forward (29 March 2026)", () => {
    // 00:59 GMT is the last minute before the change; 01:00 GMT is 02:00 BST.
    expect(decideSchedule(base, new Date("2026-03-29T00:59:00Z")).reportDate).toBe("2026-03-29");
    expect(decideSchedule(base, new Date("2026-03-29T19:29:00Z")).syncDue).toBe(false); // 20:29 BST
    expect(decideSchedule(base, new Date("2026-03-29T19:30:00Z")).syncDue).toBe(true); // 20:30 BST
  });

  it("handles the clocks going back (25 October 2026)", () => {
    // After the change UK time equals UTC.
    expect(decideSchedule(base, new Date("2026-10-25T20:29:00Z")).syncDue).toBe(false);
    expect(decideSchedule(base, new Date("2026-10-25T20:30:00Z")).syncDue).toBe(true);
    // The day before it is still BST.
    expect(decideSchedule(base, new Date("2026-10-24T19:30:00Z")).syncDue).toBe(true);
  });

  it("never syncs when switched off", () => {
    expect(decideSchedule({ ...base, syncEnabled: false }, new Date("2026-11-14T22:00:00Z")).syncDue).toBe(false);
  });

  it("falls back to 20:30 when the time is unreadable", () => {
    const settings = { ...base, syncTimeLocal: "not a time" };
    expect(decideSchedule(settings, new Date("2026-11-14T20:29:00Z")).syncDue).toBe(false);
    expect(decideSchedule(settings, new Date("2026-11-14T20:30:00Z")).syncDue).toBe(true);
  });

  it("falls back to UK time when no timezone is given", () => {
    const d = decideSchedule({ ...base, syncTimezone: "" }, new Date("2026-07-14T19:30:00Z"));
    expect(d.syncDue).toBe(true);
  });

  it("asks for last month's report from the 2nd of the month", () => {
    expect(decideSchedule(base, new Date("2026-11-01T12:00:00Z")).reportMonthDue).toBeNull();
    expect(decideSchedule(base, new Date("2026-11-02T12:00:00Z")).reportMonthDue).toBe("2026-10");
    expect(decideSchedule(base, new Date("2027-01-15T12:00:00Z")).reportMonthDue).toBe("2026-12");
  });

  it("treats 00:30 BST on the 2nd as the 2nd, even though UTC is still the 1st", () => {
    expect(decideSchedule(base, new Date("2026-07-01T23:30:00Z")).reportMonthDue).toBe("2026-06");
  });
});
