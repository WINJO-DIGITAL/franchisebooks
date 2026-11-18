import { describe, expect, it } from "vitest";
import { parseFdNumbers } from "@/lib/onboarding/franchises";
import { summariseFirstSync } from "@/lib/onboarding/progress";

describe("reading FD numbers", () => {
  it("accepts one per line, or separated by commas and spaces, in any case", () => {
    expect(parseFdNumbers("FD42102\nfd46578, FD10001;  FD20002").fdNumbers).toEqual(["FD42102", "FD46578", "FD10001", "FD20002"]);
  });

  it("accepts a space or hyphen after FD, and bare numbers", () => {
    expect(parseFdNumbers("FD 42102, FD-46578, 10001").fdNumbers).toEqual(["FD42102", "FD46578", "FD10001"]);
  });

  it("drops duplicates", () => {
    expect(parseFdNumbers("FD42102 fd42102 42102").fdNumbers).toEqual(["FD42102"]);
  });

  it("says which entries are not FD numbers, and returns none rather than a partial list", () => {
    const r = parseFdNumbers("FD42102, hello, 12");
    expect(r.fdNumbers).toEqual([]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toContain('"hello"');
  });

  it("returns nothing for an empty box", () => {
    expect(parseFdNumbers("  \n ")).toEqual({ fdNumbers: [], errors: [] });
  });
});

const job = (status: string, franchiseId: string, errorMessage: string | null = null) => ({ status, franchiseId, errorMessage });

describe("first sync progress", () => {
  it("is working before anything is queued, and while any franchise is unfinished", () => {
    expect(summariseFirstSync([], 2).phase).toBe("working");
    const p = summariseFirstSync([job("succeeded", "a"), job("running", "b")], 2);
    expect(p).toMatchObject({ phase: "working", total: 2, finished: 1, succeeded: 1 });
  });

  it("counts a job waiting for a retry as unfinished, not failed", () => {
    expect(summariseFirstSync([job("queued", "a", "The portal layout may have changed")], 1).phase).toBe("working");
  });

  it("is done once every franchise has ended and at least one was read", () => {
    expect(summariseFirstSync([job("succeeded", "a"), job("partial", "b")], 2)).toMatchObject({ phase: "done", message: null });
  });

  it("is done but explains when only some franchises could be read", () => {
    const p = summariseFirstSync([job("succeeded", "a"), job("blocked", "b", "DPD asked for a verification code.")], 2);
    expect(p.phase).toBe("done");
    expect(p.message).toContain("1 of 2");
    expect(p.message).toContain("verification code");
  });

  it("needs attention, with the reason, when nothing could be read", () => {
    const p = summariseFirstSync([job("blocked", "a", "DPD did not accept the username and password.")], 1);
    expect(p).toMatchObject({ phase: "needs_attention", message: "DPD did not accept the username and password." });
  });

  it("uses the newest job for a franchise, so a retry replaces the failure", () => {
    const p = summariseFirstSync([job("running", "a"), job("failed", "a", "old problem")], 1);
    expect(p.phase).toBe("working");
  });
});
