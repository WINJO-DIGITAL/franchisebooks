import { describe, expect, it } from "vitest";
import { assessPortalDrift, DRIFT_MIN_JOBS, type LayoutFailure } from "@/lib/dpd/drift";

const NOW = new Date("2026-11-21T12:00:00Z");
const failure = (jobId: string, accountId: string, step = "payments:table", hoursAgo = 1): LayoutFailure => ({
  jobId, accountId, step, at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
});

describe("portal layout change detection", () => {
  it("is not suspected with no failures, or too few", () => {
    expect(assessPortalDrift([], NOW)).toMatchObject({ suspected: false, jobs: 0, accounts: 0, topStep: null });
    expect(assessPortalDrift([failure("j1", "a"), failure("j2", "b")], NOW).suspected).toBe(false);
  });

  it("is suspected when enough reads fail across more than one account", () => {
    const result = assessPortalDrift([failure("j1", "a"), failure("j2", "b"), failure("j3", "a", "charges:table")], NOW);
    expect(result).toMatchObject({ suspected: true, jobs: 3, accounts: 2, topStep: "payments:table", topStepJobs: 2 });
  });

  it("is suspected when one account fails at the same step over and over", () => {
    const failures = Array.from({ length: DRIFT_MIN_JOBS }, (_, i) => failure(`j${i}`, "a"));
    expect(assessPortalDrift(failures, NOW)).toMatchObject({ suspected: true, accounts: 1, topStepJobs: DRIFT_MIN_JOBS });
  });

  it("is not suspected when one account fails at different steps, which looks like its own problem", () => {
    const failures = [failure("j1", "a", "payments:table"), failure("j2", "a", "charges:table"), failure("j3", "a", "invoices:links")];
    expect(assessPortalDrift(failures, NOW).suspected).toBe(false);
  });

  it("counts a read once however many times it was logged", () => {
    const failures = [failure("j1", "a"), failure("j1", "a"), failure("j1", "a"), failure("j2", "b")];
    expect(assessPortalDrift(failures, NOW)).toMatchObject({ suspected: false, jobs: 2 });
  });

  it("ignores failures older than a day", () => {
    const failures = [failure("j1", "a", "payments:table", 30), failure("j2", "b", "payments:table", 26), failure("j3", "c", "payments:table", 2)];
    expect(assessPortalDrift(failures, NOW)).toMatchObject({ suspected: false, jobs: 1 });
  });
});
