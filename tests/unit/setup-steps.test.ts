import { describe, expect, it } from "vitest";
import { remainingSetupSteps, type SetupState } from "@/lib/onboarding/steps";

const done: SetupState = { franchiseCount: 2, hasDpdLogin: true, hasEarnings: true, driverCount: 5, driversWithoutRate: 0, ratesMatter: true };

describe("remaining set-up steps", () => {
  it("is empty once everything is set up", () => {
    expect(remainingSetupSteps(done)).toEqual([]);
  });

  it("starts a brand-new account with franchises, then the login, then drivers", () => {
    const keys = remainingSetupSteps({ franchiseCount: 0, hasDpdLogin: false, hasEarnings: false, driverCount: 0, driversWithoutRate: 0, ratesMatter: true }).map((s) => s.key);
    expect(keys).toEqual(["franchises", "login", "drivers"]);
  });

  it("asks for the first read once the login is saved and nothing has been read", () => {
    const keys = remainingSetupSteps({ ...done, hasEarnings: false }).map((s) => s.key);
    expect(keys).toEqual(["first-read"]);
  });

  it("names how many drivers still need a pay rate, and says nothing when rates do not matter", () => {
    const [step] = remainingSetupSteps({ ...done, driversWithoutRate: 3 });
    expect(step?.key).toBe("rates");
    expect(step?.title).toContain("3 drivers");
    expect(remainingSetupSteps({ ...done, driversWithoutRate: 1 })[0]?.title).toContain("1 driver");
    expect(remainingSetupSteps({ ...done, driversWithoutRate: 3, ratesMatter: false })).toEqual([]);
  });

  it("does not ask for a first read while there is no login, or no franchise to read", () => {
    expect(remainingSetupSteps({ ...done, hasDpdLogin: false, hasEarnings: false }).map((s) => s.key)).toEqual(["login"]);
    expect(remainingSetupSteps({ ...done, franchiseCount: 0, hasEarnings: false }).map((s) => s.key)).toEqual(["franchises"]);
  });
});
