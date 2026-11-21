import { describe, expect, it } from "vitest";
import { wagesToPay, type StatementRow } from "@/lib/statements/rows";

const row = (over: Partial<StatementRow>): StatementRow => ({
  driverId: "d1", franchiseId: "f1", name: "Jamie Townsend", id: null, number: null, title: null,
  total: 10_000, emailedAt: null, reason: null, ...over,
});

describe("wagesToPay", () => {
  it("adds one driver's statements across FD numbers into one line", () => {
    const out = wagesToPay([row({ franchiseId: "f1", total: 10_000 }), row({ franchiseId: "f2", total: 5_000 })], new Map([["d1", "DR66445"]]));
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({ dr: "DR66445", franchises: 2, total: 15_000 });
    expect(out.total).toBe(15_000);
    expect(out.complete).toBe(true);
  });

  it("keeps different drivers apart, even with the same name", () => {
    const out = wagesToPay([row({ driverId: "d1", total: 10_000 }), row({ driverId: "d2", total: 4_000 })], new Map([["d1", "DR1"], ["d2", "DR2"]]));
    expect(out.lines).toHaveLength(2);
    expect(out.total).toBe(14_000);
  });

  it("does not state a total for a driver whose statement is incomplete", () => {
    const out = wagesToPay([row({ total: 10_000 }), row({ franchiseId: "f2", total: null, reason: "No day rate" })], new Map());
    expect(out.lines[0]!.total).toBeNull();
    expect(out.complete).toBe(false);
  });
});
