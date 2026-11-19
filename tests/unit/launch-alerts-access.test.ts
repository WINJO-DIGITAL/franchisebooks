import { describe, expect, it } from "vitest";
import { hiddenFranchiseIds } from "@/lib/access";
import { hiddenFranchiseFilter } from "@/lib/data/period";
import { errorAlertKey, hourBucket } from "@/lib/notify/alerts";

describe("error alert keys", () => {
  it("treats the same fault with different ids and numbers as one alert", () => {
    const a = errorAlertKey({ message: "Job 0b6f7f3e-1111-4c2d-9e0a-2b3c4d5e6f70 failed after 3 attempts" }, { where: "cron.tick" });
    const b = errorAlertKey({ message: "Job 9a6f7f3e-2222-4c2d-9e0a-2b3c4d5e6f71 failed after 4 attempts" }, { where: "cron.tick" });
    expect(a).toBe(b);
    expect(a.startsWith("error:cron.tick:")).toBe(true);
    expect(errorAlertKey({ message: "Something else" }, { where: "cron.tick" })).not.toBe(a);
  });
  it("buckets alerts by the hour", () => {
    expect(hourBucket(new Date("2026-11-19T20:59:59Z"))).toBe("2026-11-19T20");
    expect(hourBucket(new Date("2026-11-19T21:00:00Z"))).toBe("2026-11-19T21");
  });
});

describe("franchises switched off are left out of All franchises", () => {
  const franchises = [{ id: "a", isActive: true }, { id: "b", isActive: false }, { id: "c", isActive: true }];
  it("hides the switched-off ones when no franchise is chosen", () => {
    expect(hiddenFranchiseIds(franchises, null)).toEqual(["b"]);
  });
  it("hides nothing once a franchise is chosen, or when every franchise is switched off", () => {
    expect(hiddenFranchiseIds(franchises, "b")).toEqual([]);
    expect(hiddenFranchiseIds([{ id: "x", isActive: false }], null)).toEqual([]);
  });
  it("builds a filter that keeps rows with no franchise", () => {
    expect(hiddenFranchiseFilter({ hiddenFranchiseIds: ["b", "d"] })).toBe("franchise_id.is.null,franchise_id.not.in.(b,d)");
    expect(hiddenFranchiseFilter({ hiddenFranchiseIds: [] })).toBeNull();
    expect(hiddenFranchiseFilter({ franchiseId: "a", hiddenFranchiseIds: ["b"] })).toBeNull();
  });
});
