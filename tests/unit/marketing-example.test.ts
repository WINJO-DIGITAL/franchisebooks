import { describe, expect, it } from "vitest";
import { EXAMPLE_CHECKS, EXAMPLE_DAILY_INCOME, EXAMPLE_DRIVERS, EXAMPLE_FRANCHISES, EXAMPLE_PERIOD } from "@/lib/marketing/example";

describe("the example figures on the sales page", () => {
  it("has 28 days whose income adds up to the period's income", () => {
    expect(EXAMPLE_DAILY_INCOME).toHaveLength(28);
    expect(EXAMPLE_DAILY_INCOME.reduce((n, v) => n + v, 0)).toBe(EXAMPLE_PERIOD.income);
  });

  it("leaves profit as income less charges less driver pay", () => {
    expect(EXAMPLE_PERIOD.income - EXAMPLE_PERIOD.charges - EXAMPLE_PERIOD.driverPay).toBe(EXAMPLE_PERIOD.profit);
  });

  it("pays each driver rate × quantity, and the drivers add up to the driver pay", () => {
    for (const d of EXAMPLE_DRIVERS) expect(d.rate * d.quantity).toBe(d.owed);
    expect(EXAMPLE_DRIVERS.reduce((n, d) => n + d.owed, 0)).toBe(EXAMPLE_PERIOD.driverPay);
  });

  it("shows the first franchise with the same income and profit as the period overview", () => {
    expect(EXAMPLE_FRANCHISES[0]!.income).toBe(EXAMPLE_PERIOD.income);
    expect(EXAMPLE_FRANCHISES[0]!.profit).toBe(EXAMPLE_PERIOD.profit);
  });

  it("agrees in the matching check, and is one Saturday short in the other", () => {
    expect(EXAMPLE_CHECKS.matches.dailyPayments).toBe(EXAMPLE_CHECKS.matches.invoiceStopPay);
    expect(EXAMPLE_CHECKS.differs.invoiceStopPay - EXAMPLE_CHECKS.differs.dailyPayments).toBe(EXAMPLE_DAILY_INCOME[5]);
  });
});
