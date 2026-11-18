import { afterEach, describe, expect, it } from "vitest";
import { dispatchSyncWorkflow, startWorkerRun } from "@/lib/github/dispatch";

const saved = process.env.GITHUB_SYNC_TOKEN;
afterEach(() => {
  if (saved === undefined) delete process.env.GITHUB_SYNC_TOKEN; else process.env.GITHUB_SYNC_TOKEN = saved;
});

describe("starting the sync workflow from the website", () => {
  it("says so plainly when no token is set, and does not call GitHub", async () => {
    delete process.env.GITHUB_SYNC_TOKEN;
    let called = false;
    const r = await dispatchSyncWorkflow({ force: true }, (async () => { called = true; return new Response(null, { status: 204 }); }) as typeof fetch);
    expect(r).toMatchObject({ started: false, reason: "not_configured" });
    expect(called).toBe(false);
  });

  it("asks GitHub to run the workflow on main, with the force option, and reports success on 204", async () => {
    process.env.GITHUB_SYNC_TOKEN = "github_pat_test";
    let url = ""; let body: unknown; let auth = "";
    const fakeFetch = (async (u: string, init: RequestInit) => { url = u; body = JSON.parse(String(init.body)); auth = String((init.headers as Record<string, string>).authorization); return new Response(null, { status: 204 }); }) as typeof fetch;
    const r = await dispatchSyncWorkflow({ force: true }, fakeFetch);
    expect(r).toEqual({ started: true });
    expect(url).toBe("https://api.github.com/repos/WINJO-DIGITAL/matthewai/actions/workflows/dpd-sync.yml/dispatches");
    expect(body).toEqual({ ref: "main", inputs: { force: "true", report_date: "" } });
    expect(auth).toBe("Bearer github_pat_test");
  });

  it("explains a refusal in plain English", async () => {
    process.env.GITHUB_SYNC_TOKEN = "github_pat_test";
    const r = await dispatchSyncWorkflow({ force: true }, (async () => new Response("no", { status: 403 })) as typeof fetch);
    expect(r).toMatchObject({ started: false, reason: "refused" });
    expect((r as { message: string }).message).toContain("403");
  });
  it("starts a run that only works through what is queued, without forcing a new sync of everyone", async () => {
    process.env.GITHUB_SYNC_TOKEN = "test-token";
    let body: unknown = null;
    const fakeFetch = (async (_url: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
    const r = await startWorkerRun(fakeFetch);
    expect(r.started).toBe(true);
    expect(body).toEqual({ ref: "main", inputs: { force: "false", report_date: "" } });
  });
});
