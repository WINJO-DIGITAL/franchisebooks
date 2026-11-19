import { describe, expect, it } from "vitest";
import { pageSaysNoCharges } from "@/lib/dpd/session";

describe("a Transaction Charges page with nothing on it", () => {
  it("is a true zero when the page says so", () => {
    expect(pageSaysNoCharges("Transaction Charges Routes FD78797 Total £0.00")).toBe(true);
    expect(pageSaysNoCharges("Transaction Charges No charges found for this period")).toBe(true);
    expect(pageSaysNoCharges("Transaction Charges Total 0.00")).toBe(true);
    expect(pageSaysNoCharges("Transaction Charges No payment")).toBe(true);
    expect(pageSaysNoCharges("Transaction Charges No payments due")).toBe(true);
    expect(pageSaysNoCharges("Transaction Charges Nothing is due")).toBe(true);
  });
  it("is NOT a zero for an unfamiliar page, so a changed layout still raises an error", () => {
    expect(pageSaysNoCharges("Welcome back Loading Sign out")).toBe(false);
    expect(pageSaysNoCharges("Transaction Charges Total £120.50")).toBe(false);
    expect(pageSaysNoCharges("Something went wrong, please try again")).toBe(false);
  });
});
