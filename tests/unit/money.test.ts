import { describe, expect, it } from "vitest";
import {
  allocateProportionally, formatGBP, fromDb, parseMoney, parseRate, percentChange, percentOf, perUnit, rateTimes, sumPence, toDb,
} from "@/lib/money";

describe("parseMoney", () => {
  it.each([
    ["£1,234.56", 123456], ["1234.5", 123450], ["0.07", 7], ["12", 1200], ["-12.50", -1250], ["(12.50)", -1250],
    ["12.50-", -1250], ["£ 45.00", 4500], ["-£45.10", -4510], ["£-45.10", -4510], ["12.50 CR", -1250], ["+3.00", 300],
    ["1,000,000.01", 100000001], ["0", 0], ["0.00", 0],
  ])("reads %s", (text, pence) => {
    expect(parseMoney(text)).toBe(pence);
  });

  it.each(["", "  ", "abc", "12.345", "1,23.00", "1.2.3", "£", "12,34", "1e3", "NaN", "12.5.0"])(
    "refuses to guess at %j",
    (text) => {
      expect(parseMoney(text)).toBeNull();
    },
  );

  it("treats null as unreadable, never as zero", () => {
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
});

describe("database round trip", () => {
  it("converts numerics without floating point drift", () => {
    expect(fromDb(0.1 + 0.2)).toBe(30);
    expect(fromDb(1234.56)).toBe(123456);
    expect(fromDb("1234.56")).toBe(123456);
    expect(fromDb(-0.01)).toBe(-1);
    expect(fromDb(null)).toBe(0);
    expect(fromDb(19.99)).toBe(1999);
    expect(fromDb(4.35)).toBe(435);
  });

  it("rejects values with more than two decimal places", () => {
    expect(() => fromDb(1.234)).toThrow();
  });

  it("is exact for every pence value in a wide range", () => {
    for (let p = -250_000; p <= 250_000; p += 7) {
      expect(fromDb(Number(toDb(p)))).toBe(p);
      expect(parseMoney(toDb(p))).toBe(p);
    }
  });

  it("writes exact decimal strings", () => {
    expect(toDb(123456)).toBe("1234.56");
    expect(toDb(-5)).toBe("-0.05");
    expect(toDb(0)).toBe("0.00");
  });
});

describe("formatGBP", () => {
  it("uses UK currency formatting", () => {
    expect(formatGBP(123456)).toBe("£1,234.56");
    expect(formatGBP(0)).toBe("£0.00");
    expect(formatGBP(-1250)).toBe("−£12.50");
    expect(formatGBP(5000, { signed: true })).toBe("+£50.00");
    expect(formatGBP(120000, { compact: true })).toBe("£1,200");
    expect(formatGBP(null)).toBe("—");
  });
});

describe("arithmetic helpers", () => {
  it("sums pence exactly", () => {
    expect(sumPence([10, 20, 30])).toBe(60);
    expect(sumPence(Array.from({ length: 1000 }, () => 1))).toBe(1000);
  });

  it("averages with half-up rounding", () => {
    expect(perUnit(1000, 3)).toBe(333);
    expect(perUnit(1001, 2)).toBe(501);
    expect(perUnit(-1001, 2)).toBe(-501);
    expect(perUnit(100, 0)).toBeNull();
  });

  it("computes percentages to one decimal place", () => {
    expect(percentOf(1, 3)).toBe(33.3);
    expect(percentOf(50, 0)).toBeNull();
    expect(percentChange(100, 70)).toBe(-30);
    expect(percentChange(0, 70)).toBeNull();
  });

  it("allocates so that the parts always add up to the whole", () => {
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportionally(1000, [3, 1])).toEqual([750, 250]);
    for (const total of [1, 99, 100, 12345, 999999]) {
      const parts = allocateProportionally(total, [5, 3, 7, 11, 2]);
      expect(sumPence(parts)).toBe(total);
    }
    expect(() => allocateProportionally(100, [0, 0])).toThrow();
  });

  it("handles unit rates as exact decimals", () => {
    expect(parseRate("0.875")).toBe("0.8750");
    expect(parseRate("£1.10")).toBe("1.1000");
    expect(parseRate("87.5p")).toBe("0.8750");
    expect(parseRate("abc")).toBeNull();
    expect(rateTimes("0.8750", 120)).toBe(10500);
    expect(rateTimes("1.1000", 97)).toBe(10670);
    expect(rateTimes(0.875, 3)).toBe(263);
  });
});
