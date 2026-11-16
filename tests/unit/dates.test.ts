import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, daysBetween, eachDay, formatMonth, formatRelative, formatUkDate, formatUkDateLong, formatUkDateTime,
  isISODate, londonMinutesOfDay, londonToday, monthRange, parseTimeToMinutes, parseUkDate, weekdayOf, weekStart,
} from "@/lib/dates";

describe("parseUkDate", () => {
  it.each([
    ["14/11/2026", "2026-11-14"], ["1/2/26", "2026-02-01"], ["03-04-2026", "2026-04-03"], ["14.11.2026", "2026-11-14"],
    ["2026-11-14", "2026-11-14"], ["14 Nov 2026", "2026-11-14"], ["14-Nov-26", "2026-11-14"],
    ["Saturday 14 November 2026", "2026-11-14"], ["Sat, 14 Nov 2026", "2026-11-14"], ["1st December 2026", "2026-12-01"],
    ["2026-11-14T20:30:00Z", "2026-11-14"],
  ])("reads %s day-first", (text, iso) => {
    expect(parseUkDate(text)).toBe(iso);
  });

  it.each(["", "31/02/2026", "14/13/2026", "tomorrow", "2026/11/14x", "32/01/2026", "14 Foo 2026"])("rejects %j", (text) => {
    expect(parseUkDate(text)).toBeNull();
  });

  it("never reads a date month-first", () => {
    expect(parseUkDate("03/04/2026")).toBe("2026-04-03");
  });
});

describe("UK formatting", () => {
  it("formats dates the UK way", () => {
    expect(formatUkDate("2026-11-14")).toBe("14/11/2026");
    expect(formatUkDateLong("2026-11-14")).toBe("Sat 14 Nov 2026");
    expect(formatMonth("2026-11")).toBe("November 2026");
    expect(formatUkDate(null)).toBe("—");
  });

  it("shows instants in UK local time across the clock change", () => {
    expect(formatUkDateTime("2026-07-01T19:30:00Z")).toBe("01/07/2026 20:30"); // BST
    expect(formatUkDateTime("2026-12-01T20:30:00Z")).toBe("01/12/2026 20:30"); // GMT
  });

  it("describes recent times in plain English", () => {
    const now = new Date("2026-11-14T21:00:00Z");
    expect(formatRelative("2026-11-14T20:59:40Z", now)).toBe("just now");
    expect(formatRelative("2026-11-14T20:30:00Z", now)).toBe("30 minutes ago");
    expect(formatRelative("2026-11-14T08:05:00Z", now)).toBe("today at 08:05");
    expect(formatRelative("2026-11-13T20:31:00Z", now)).toBe("yesterday at 20:31");
    expect(formatRelative(null, now)).toBe("never");
  });
});

describe("UK timezone", () => {
  it("knows today's UK date either side of midnight in summer time", () => {
    expect(londonToday(new Date("2026-06-30T22:59:00Z"))).toBe("2026-06-30");
    expect(londonToday(new Date("2026-06-30T23:01:00Z"))).toBe("2026-07-01");
    expect(londonToday(new Date("2026-12-31T23:59:00Z"))).toBe("2026-12-31");
  });

  it("reads the UK wall clock in minutes", () => {
    expect(londonMinutesOfDay(new Date("2026-07-01T19:30:00Z"))).toBe(20 * 60 + 30);
    expect(londonMinutesOfDay(new Date("2026-12-01T20:30:00Z"))).toBe(20 * 60 + 30);
  });
});

describe("calendar arithmetic", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-01", "2026-11-14")).toBe(13);
    expect(eachDay("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
  });

  it("is unaffected by the clock change", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("handles weeks and months", () => {
    expect(weekdayOf("2026-11-14")).toBe(6);
    expect(weekStart("2026-11-14")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("validates ISO dates and times", () => {
    expect(isISODate("2026-11-14")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("14/11/2026")).toBe(false);
    expect(parseTimeToMinutes("20:30")).toBe(1230);
    expect(parseTimeToMinutes("20:30:00")).toBe(1230);
    expect(parseTimeToMinutes("25:00")).toBeNull();
  });
});
