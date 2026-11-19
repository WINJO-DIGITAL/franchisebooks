import { describe, expect, it } from "vitest";
import { billingAudience, reportScopeProblem, seesAllFranchises } from "@/lib/access";

describe("billingAudience", () => {
  it("sends drivers away from the plan page", () => {
    expect(billingAudience({ isDriver: true, role: null })).toBe("driver");
  });
  it("treats managers and viewers as covered by their owner", () => {
    expect(billingAudience({ isDriver: false, role: "manager" })).toBe("member");
    expect(billingAudience({ isDriver: false, role: "viewer" })).toBe("member");
  });
  it("lets owners and new sign-ups subscribe", () => {
    expect(billingAudience({ isDriver: false, role: "owner" })).toBe("payer");
    expect(billingAudience({ isDriver: false, role: null })).toBe("payer");
  });
});

describe("reportScopeProblem", () => {
  const north = "11111111-1111-4111-8111-111111111111";
  const south = "22222222-2222-4222-8222-222222222222";

  it("lets the owner make an all-franchises report", () => {
    expect(seesAllFranchises({ role: "owner", allFranchises: false })).toBe(true);
    expect(reportScopeProblem({ role: "owner", allFranchises: false, visibleFranchiseIds: [north, south], franchiseId: null })).toBeNull();
  });
  it("lets a manager with every franchise make an all-franchises report", () => {
    expect(reportScopeProblem({ role: "manager", allFranchises: true, visibleFranchiseIds: [north, south], franchiseId: null })).toBeNull();
  });
  it("refuses an all-franchises report for a manager limited to some franchises", () => {
    expect(reportScopeProblem({ role: "manager", allFranchises: false, visibleFranchiseIds: [north], franchiseId: null })).toMatch(/only some franchises/);
  });
  it("lets a limited manager report on their own franchise but not another", () => {
    expect(reportScopeProblem({ role: "manager", allFranchises: false, visibleFranchiseIds: [north], franchiseId: north })).toBeNull();
    expect(reportScopeProblem({ role: "manager", allFranchises: false, visibleFranchiseIds: [north], franchiseId: south })).toBe("Choose one of your franchises.");
  });
  it("says there is nothing to report when a non-owner can see no franchises", () => {
    expect(reportScopeProblem({ role: "viewer", allFranchises: true, visibleFranchiseIds: [], franchiseId: null })).toBe("There is nothing to report on yet.");
  });
});

describe("upload access", () => {
  it("finds rows going to franchises the login does not cover", async () => {
    const { franchisesOutsideAccess } = await import("@/lib/access");
    expect(franchisesOutsideAccess(["n", "n"], ["n"])).toEqual([]);
    expect(franchisesOutsideAccess(["n", "s", "s"], ["n"])).toEqual(["s"]);
    expect(franchisesOutsideAccess(["n", ""], ["n"])).toEqual([null]);
    expect(franchisesOutsideAccess(["s", null], null)).toEqual([]);
  });
  it("explains the refusal in plain words", async () => {
    const { outsideAccessMessage } = await import("@/lib/access");
    expect(outsideAccessMessage("a.pdf", ["FD-2"])).toBe("“a.pdf” is for FD-2, which your login doesn't cover. Ask the owner to upload it. Nothing was imported.");
    expect(outsideAccessMessage("a.pdf", ["FD-2", "FD-3"])).toContain("is for FD-2 and FD-3,");
    expect(outsideAccessMessage("a.pdf", [])).toContain("Choose your franchise when uploading");
  });
});
