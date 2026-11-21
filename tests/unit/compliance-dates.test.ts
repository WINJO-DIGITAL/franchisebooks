import { describe, expect, it } from "vitest";
import { DUE_SOON_DAYS, reminderFor, reminderText } from "@/lib/compliance/dates";

const TODAY = "2026-11-21";

describe("compliance date reminders", () => {
  it("marks a date that has passed as overdue, with the days", () => {
    expect(reminderFor("2026-11-18", TODAY)).toEqual({ status: "overdue", days: -3 });
    expect(reminderText(reminderFor("2026-11-18", TODAY))).toBe("Overdue by 3 days");
    expect(reminderText(reminderFor("2026-11-20", TODAY))).toBe("Overdue by 1 day");
  });

  it("marks today as due today, not overdue", () => {
    expect(reminderFor(TODAY, TODAY).status).toBe("due_soon");
    expect(reminderText(reminderFor(TODAY, TODAY))).toBe("Due today");
  });

  it("marks dates within the window as due soon, including the last day of it", () => {
    expect(reminderFor("2026-12-21", TODAY)).toEqual({ status: "due_soon", days: DUE_SOON_DAYS });
    expect(reminderText(reminderFor("2026-11-30", TODAY))).toBe("Due in 9 days");
  });

  it("leaves later dates as current", () => {
    expect(reminderFor("2026-12-22", TODAY).status).toBe("current");
    expect(reminderText(reminderFor("2027-03-01", TODAY))).toBe("In 100 days");
  });

  it("handles month and year boundaries", () => {
    expect(reminderFor("2027-01-01", "2026-12-31").days).toBe(1);
    expect(reminderFor("2026-02-28", "2026-03-01")).toEqual({ status: "overdue", days: -1 });
  });
});
