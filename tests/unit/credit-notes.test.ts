import { describe, expect, it } from "vitest";
import { isCreditNote, revenueDescription } from "@/lib/finance/credit-notes";

describe("credit notes", () => {
  it("labels a credit note, with the owner's note after it", () => {
    expect(revenueDescription("credit_note", null)).toBe("Credit note");
    expect(revenueDescription("credit_note", "Mileage correction, period ending 8 Nov")).toBe("Credit note: Mileage correction, period ending 8 Nov");
  });

  it("leaves an ordinary payment's note alone", () => {
    expect(revenueDescription("payment", "Statement 12")).toBe("Statement 12");
    expect(revenueDescription("payment", "  ")).toBeNull();
    expect(revenueDescription("payment", null)).toBeNull();
  });

  it("recognises a credit note by its label", () => {
    expect(isCreditNote("Credit note: x")).toBe(true);
    expect(isCreditNote("Statement 12")).toBe(false);
    expect(isCreditNote(null)).toBe(false);
  });
});
