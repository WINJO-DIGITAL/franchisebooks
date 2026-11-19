import { describe, expect, it } from "vitest";
import { checkPeriod, vatOn, type CheckInvoice } from "@/lib/finance/period-check";

const period = { start: "2026-10-12", end: "2026-11-08" };

// FD42102, 12 Oct to 8 Nov 2026: the figures on the real invoices.
const invoice: CheckInvoice = {
  invoiceNo: "FI1041458",
  dueDate: "2026-11-13",
  netTotal: 730336,
  vatTotal: 146067,
  invoiceTotal: 876403,
  reconciled: true,
  lines: [
    { description: "Successful collection and delivery stops Monday - Friday:", amount: 578205 },
    { description: "Successful collection and delivery stops Saturday", amount: 80592 },
    { description: "Successful collection and delivery stops Sunday", amount: 58189 },
    { description: "Excess parcels", amount: 5300 },
    { description: "C&D App", amount: 923 },
    { description: "Fuel Supplement", amount: 7127 },
  ],
};
const charges = [1500, 35199, 24725, 12887]; // management fee, fuel usage, temporary van hire, uniform

describe("period check", () => {
  it("matches when our daily payments equal the invoice's stop pay, and separates the extras", () => {
    const c = checkPeriod({ period, payments: [722286], charges, invoice, tolerancePence: 100 });
    expect(c.income.status).toBe("match");
    expect(c.income.invoiceStopPay).toBe(722286);
    expect(c.income.difference).toBe(0);
    expect(c.income.extras.map((l) => l.description)).toEqual(["C&D App", "Fuel Supplement"]);
  });

  it("says how far apart they are when they differ", () => {
    const c = checkPeriod({ period, payments: [700000], charges, invoice, tolerancePence: 100 });
    expect(c.income.status).toBe("differs");
    expect(c.income.difference).toBe(700000 - 722286);
  });

  it("allows a difference within the tolerance", () => {
    const c = checkPeriod({ period, payments: [722286 - 80], charges, invoice, tolerancePence: 100 });
    expect(c.income.status).toBe("match");
  });

  it("waits when the self-billed invoice is not in yet, and still gives the due date", () => {
    const c = checkPeriod({ period, payments: [722286], charges, invoice: null, tolerancePence: 100 });
    expect(c.income.status).toBe("waiting");
    expect(c.income.invoiceStopPay).toBeNull();
    expect(c.payable.expected).toBeNull();
    expect(c.payable.dueDate).toBe("2026-11-13"); // five days after the period closes
  });

  it("does not trust an invoice whose lines could not be read", () => {
    const c = checkPeriod({ period, payments: [722286], charges, invoice: { ...invoice, reconciled: false }, tolerancePence: 100 });
    expect(c.income.status).toBe("unreadable");
    expect(c.payable.expected).toBeNull();
  });

  it("totals the charges and estimates VAT and the Friday payment, within a penny of DPD's own figures", () => {
    const c = checkPeriod({ period, payments: [722286], charges, invoice, tolerancePence: 100 });
    expect(c.charges.net).toBe(74311); // DPD invoice: £743.11
    expect(Math.abs(c.charges.vatEstimate - 14863)).toBeLessThanOrEqual(1); // DPD invoice: £148.63
    expect(Math.abs((c.payable.expected ?? 0) - 787229)).toBeLessThanOrEqual(1); // remittance: £7,872.29
  });

  it("works out VAT at 20% to the penny", () => {
    expect(vatOn(1500)).toBe(300);
    expect(vatOn(24725)).toBe(4945);
  });

  it("does not call it a mismatch when the app never read the period: no data is not zero earned", () => {
    // The app only holds daily payments from 9 Nov, so a period that closed on 8 Nov has no days to compare with.
    const c = checkPeriod({ period, payments: [], charges, invoice, tolerancePence: 100, coverage: { first: "2026-11-09", last: "2026-11-19" } });
    expect(c.income.status).toBe("unread");
    expect(c.income.difference).toBeNull();
    expect(c.income.invoiceStopPay).toBe(722286); // the invoice's own figure is still shown
  });

  it("says unread when no daily payments have been read at all", () => {
    const c = checkPeriod({ period, payments: [], charges, invoice, tolerancePence: 100, coverage: { first: null, last: null } });
    expect(c.income.status).toBe("unread");
  });

  it("still compares, and still reports a real difference, once the app holds the whole period", () => {
    const covered = { first: "2026-10-12", last: "2026-11-19" };
    expect(checkPeriod({ period, payments: [722286], charges, invoice, tolerancePence: 100, coverage: covered }).income.status).toBe("match");
    const off = checkPeriod({ period, payments: [700000], charges, invoice, tolerancePence: 100, coverage: covered });
    expect(off.income.status).toBe("differs");
    expect(off.income.difference).toBe(700000 - 722286);
  });
});
