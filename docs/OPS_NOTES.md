# Ops and QA notes

_Progress notes from the `ops-qa` branch. Updated after each part._

## Errors that come from the other session's code (for them to fix)

Checked on `ops-qa` (base 01d7f33) with the final commit. Everything in the ops-owned files is clean; the items below are the only failures left, and none of them is in a file this branch owns.

### Typecheck (`npm run typecheck`): 1 error

| File | Error | Fix |
| --- | --- | --- |
| `src/app/(app)/page.tsx` line 5 | `TS2307: Cannot find module '@/components/sync-buttons'` | Add `src/components/sync-buttons.tsx` (their unpushed work). It is used at line 274 as `<SyncButtons dpdRunning={boolean} dropboxRunning={boolean} dropboxConnected={boolean} />`, so it must accept exactly those three boolean props and be exported by name as `SyncButtons`. |

### Build (`npm run build`): fails for the same reason

The build stops at the type-check step on the error above. With a throw-away stand-in component accepting those props, `next build` succeeds (all routes compile, including the new error, not-found and health pages). Missing component only; no other build errors.

### Lint (`npm run lint`): crashes on the pinned TypeScript, clean otherwise

* **Cause:** `package.json` pins `"typescript": "^7.0.2"`. The typescript-eslint inside `eslint-config-next` refuses TS 7: `typescript-eslint does not support TS 7.0`. ESLint exits before checking any file.
* **Fix:** pin `typescript` to `~6.0` in `package.json` (and refresh `package-lock.json`), or wait for typescript-eslint to support TS 7. This is in `package.json` `devDependencies`, which this branch may not change.
* **With TypeScript 6 installed (`npm i --no-save typescript@~6.0`) the whole repository lints with 0 errors and 1 warning:** `postcss.config.mjs` line 1, `import/no-anonymous-default-export` ("Assign object to a variable before exporting as module default"). That file is not owned by this branch.
* **Typecheck is the same under TS 6 and TS 7** (only the sync-buttons error).
* **CI:** `.github/workflows/ci.yml` installs TS 6 with `--no-save` just for the lint step so CI can lint today. Remove that install line once `typescript` is pinned.

### Not yet run anywhere (needs a local Supabase)

Database tests (`npm run test:db`), integration tests (`npm run test:integration`), the e2e suite (`npm run test:e2e`), and the `create-owner` / `seed-demo` inserts. This environment has no Docker daemon. Run these first on a machine with Docker once the two code fixes above are in.

## Progress

* [x] Unit tests: schedule, schemas, logger, crypto, env (204 unit tests pass in total).
* [x] Error pages (`error.tsx`, `global-error.tsx`, `not-found.tsx`, `(app)/error.tsx`, `(app)/loading.tsx`), `src/components/errors/**`, `/api/health` (+ unit test), `src/instrumentation.ts`.
* [x] Scripts: `create-owner`, `seed-demo` (refuses production; tested guard logic), `smoke` (new `npm run smoke`), shared helpers in `scripts/lib/**`. Extra unit tests in `tests/unit/scripts.test.ts` and `tests/unit/health.test.ts`.
  * **Not run against a real database**: this build environment has no Docker daemon, so `supabase start` is unavailable. `create-owner` and `seed-demo` were type-checked and the production guard was exercised, but the inserts have not been executed. First thing to do locally: `npm run db:start && npm run db:reset && npm run seed:demo`.
  * `smoke` expects a public `/health` on the worker (200 when up) and that `/api/cron/tick` returns 401/403 without the bearer secret. Please confirm both in the other session's code.
* [x] `vercel.json` (cron every 10 minutes), `deploy/worker/{Dockerfile,fly.toml}`, `railway.json`, `render.yaml`, `.dockerignore`, `.github/workflows/ci.yml`.
  * Worker assumptions to confirm in `worker/index.ts` (other session): it listens on `$PORT` (default 8080), answers `GET /health` with 200 without auth, and runs under `node --import tsx`. The image sets `NODE_OPTIONS=--conditions=react-server` because `src/lib` modules `import "server-only"`, which otherwise throws outside Next.js.
  * `railway.json` and `render.yaml` sit at the repository root because those platforms look for them there; the Docker build context is the repository root for all three hosts.
  * Vercel's Hobby plan only allows daily crons. A 10-minute schedule needs Pro, or switch `vercel.json` to daily and rely on the worker's own timer (see docs/DEPLOYMENT.md).
* [x] Playwright: `playwright.config.ts` (desktop 1280 and phone 390 projects, `next start` web server), `tests/e2e/` (setup, auth/onboarding/password reset, dashboard, navigation, WCAG AA with axe, responsive checks and screenshots at 320/390/1280). New devDependency: `@axe-core/playwright`.
  * **What was and was not run here.** With a temporary stand-in for the missing sync-buttons component (not committed) the app built, and I checked in a real browser: the sign-in page (320 and 1280 px) and the not-found page (390 px) have no axe WCAG AA violations or sideways overflow, `/api/health` answers, and the error page renders with its technical-details section and is accessible. The full e2e suite (163 test cases across 6 files, listed OK with `playwright test --list`) needs a local Supabase, which this environment cannot start (no Docker daemon), so the signed-in journeys, the password-reset email flow and the onboarding flow have **not been executed**. Run them first: `npm run db:start`, copy the printed keys into `.env.local`, `npm run build`, `npm run test:e2e`.
  * Screens that do not exist on this branch (everything except the dashboard and More) make their tests skip with a message instead of failing; once the other branch is merged they run for real.
  * The reset-password test reads the email from the local Mailpit (`http://127.0.0.1:54324`, override with `MAILPIT_URL`). If `supabase/config.toml` changes the mail catcher port, update it.
  * `axe` needs pages created from a browser context (`browser.newContext()`), which the Playwright `page` fixture already is.
* [x] Docs: `README.md`, `docs/DATABASE.md`, `docs/FINANCE.md`, `docs/DEPLOYMENT.md`, `docs/RUNBOOK.md`; `.env.example` Ops block.
  * Docs describe the intended Data & Integrations screen buttons ("Sync now", "Explore the DPD portal", "Reconnect", "Upload files", Review) from ARCHITECTURE.md and the existing layout; please check the exact button labels against the screens once built and tell me / adjust the runbook.

## Things for the other session (changes I may not make)

* `supabase/config.toml` has `enable_signup = true` (local). ARCHITECTURE says public sign-up is off by default. The production setting is a Supabase dashboard switch (documented in DEPLOYMENT.md step 1.2); for local parity consider `enable_signup = false` and creating users with `create-owner`. Note the e2e tests create users through the admin API, so they work either way.
* `worker/index.ts` must expose `GET /health` (200, no auth) on `$PORT` and be runnable with `node --import tsx worker/index.ts`.
* `/api/cron/tick` must return 401/403 without the correct bearer secret (the smoke test checks this). `/api/reports/*` must not return 200 to signed-out callers (it is covered by the session proxy already).
* `npm run lint` is broken at the base commit (TypeScript 7 vs typescript-eslint). CI's lint step will stay red until `typescript` is pinned to a supported version.
* `package.json` `engines.node >=22` matches the Dockerfile base image (Node 22).
