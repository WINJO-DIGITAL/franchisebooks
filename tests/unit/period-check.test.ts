import { describe, expect, it } from "vitest";
import { checkPeriod, type CheckInvoice } from "@/lib/finance/period-check";

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
// management fee, fuel usage, temporary van hire, uniform: the amounts before VAT, with the VAT the portal states on each
const charges = [{ net: 1500, vat: 300 }, { net: 35199, vat: 7040 }, { net: 24725, vat: 4945 }, { net: 12887, vat: 2577 }];

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

  it("waits when the self-billed invoice is not in yet, and shows no invoice figures", () => {
    const c = checkPeriod({ period, payments: [722286], charges, invoice: null, tolerancePence: 100 });
    expect(c.income.status).toBe("waiting");
    expect(c.income.invoiceStopPay).toBeNull();
    expect(c.invoiceStated).toBeNull(); // no due date or total is worked out for an invoice that is not in
  });

  it("does not trust an invoice whose lines could not be read", () => {
    const c = checkPeriod({ period, payments: [722286], charges, invoice: { ...invoice, reconciled: false }, tolerancePence: 100 });
    expect(c.income.status).toBe("unreadable");
  });

  it("totals the charges before VAT, the VAT the portal states, and the two together: stated figures only", () => {
    const c = checkPeriod({ period, payments: [722286], charges, invoice, tolerancePence: 100 });
    expect(c.charges).toEqual({ count: 4, net: 74311, vatStated: 14862, vatStatedOn: 4, gross: 89173 });
    expect(c.invoiceStated).toEqual({ dueDate: "2026-11-13", netTotal: 730336, vatTotal: 146067, invoiceTotal: 876403 }); // as printed
  });

  it("adds no VAT for a charge the portal states none for, and says on how many it was stated", () => {
    const c = checkPeriod({ period, payments: [], charges: [{ net: 1000, vat: 200 }, { net: 500, vat: null }], invoice: null, tolerancePence: 100 });
    expect(c.charges).toMatchObject({ net: 1500, vatStated: 200, vatStatedOn: 1, gross: 1700 });
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
