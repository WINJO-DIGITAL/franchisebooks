/**
 * Production smoke test: a handful of read-only checks that the live site is
 * up and locked down. It changes nothing and needs no sign-in.
 *
 *   npm run smoke -- https://your-app.example.com
 *   SMOKE_BASE_URL=https://your-app.example.com npm run smoke
 *
 * Optional: WORKER_URL also checks the background worker's /health.
 * Exit code 0 = every check passed; 1 = at least one failed.
 */

import { loadEnvFiles } from "./lib/env";

interface Check {
  name: string;
  run: () => Promise<string>;
}

loadEnvFiles();

const base = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("\n✗ Give the web address to check, for example:  npm run smoke -- https://your-app.example.com\n");
  process.exit(1);
}

async function get(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(15_000), ...init });
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const checks: Check[] = [
  {
    name: "Health check says the app and database are up",
    async run() {
      const r = await get("/api/health");
      const body = (await r.json().catch(() => ({}))) as { status?: string; checks?: { database?: string } };
      expect(r.status === 200, `expected 200, got ${r.status}`);
      expect(body.status === "ok", `status was "${body.status}" (database: ${body.checks?.database})`);
      return "ok";
    },
  },
  {
    name: "Sign-in page loads",
    async run() {
      const r = await get("/login");
      expect(r.status === 200, `expected 200, got ${r.status}`);
      expect((await r.text()).includes("Sign in"), 'page did not contain "Sign in"');
      return "ok";
    },
  },
  {
    name: "Private pages send signed-out visitors to sign in",
    async run() {
      for (const path of ["/", "/drivers", "/earnings", "/settings"]) {
        const r = await get(path);
        const location = r.headers.get("location") ?? "";
        expect(r.status >= 300 && r.status < 400 && location.includes("/login"), `${path} did not redirect to /login (status ${r.status})`);
      }
      return "ok";
    },
  },
  {
    name: "Scheduled-job endpoint refuses requests without the secret",
    async run() {
      for (const headers of [{} as Record<string, string>, { authorization: "Bearer wrong-secret" }]) {
        const r = await get("/api/cron/tick", { headers });
        expect(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
      }
      return "ok";
    },
  },
  {
    name: "Data endpoints are closed to signed-out visitors",
    async run() {
      const r = await get("/api/reports/monthly");
      expect(r.status === 401 || r.status === 404 || (r.status >= 300 && r.status < 400), `expected 401/404/redirect, got ${r.status}`);
      return "ok";
    },
  },
  {
    name: "Unknown pages show the friendly not-found page",
    async run() {
      const r = await get("/this-page-does-not-exist");
      const location = r.headers.get("location") ?? "";
      // Signed out, the proxy sends this to sign-in first; either outcome is correct, a 5xx is not.
      expect(r.status < 500, `server error ${r.status}`);
      expect(r.status === 404 || location.includes("/login"), `unexpected status ${r.status}`);
      return "ok";
    },
  },
  {
    name: "No sensitive files are served",
    async run() {
      for (const path of ["/.env", "/.env.local", "/.git/config", "/package.json"]) {
        const r = await get(path);
        const text = r.status === 200 ? await r.text() : "";
        expect(!/SUPABASE_SERVICE_ROLE_KEY|\[core\]|"dependencies"/.test(text), `${path} exposes file contents`);
      }
      return "ok";
    },
  },
];

if (process.env.WORKER_URL?.trim()) {
  const worker = process.env.WORKER_URL.trim().replace(/\/$/, "");
  checks.push({
    name: "Background worker is up",
    async run() {
      const r = await fetch(`${worker}/health`, { signal: AbortSignal.timeout(15_000) });
      expect(r.status === 200, `expected 200, got ${r.status}`);
      return "ok";
    },
  });
}

async function main() {
  console.log(`\nSmoke test: ${base}\n`);
  let failed = 0;
  for (const check of checks) {
    const started = Date.now();
    try {
      await check.run();
      console.log(`  ✓ ${check.name} (${Date.now() - started} ms)`);
    } catch (error) {
      failed++;
      console.log(`  ✗ ${check.name}\n      ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(failed === 0 ? `\nAll ${checks.length} checks passed.\n` : `\n${failed} of ${checks.length} checks FAILED.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
