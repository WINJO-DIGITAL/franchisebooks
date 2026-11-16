# Ops and QA notes

_Progress notes from the `ops-qa` branch. Updated after each part._

## Known gaps on the base commit (01d7f33)

* **Build/typecheck**: `src/app/(app)/page.tsx` imports `@/components/sync-buttons`, which only exists in the other session's unpushed work. `npm run typecheck` therefore reports exactly one error (TS2307) until that branch is merged. Not created here, by instruction.
* **Lint is broken at the base commit**: `npm run lint` crashes with "typescript-eslint does not support TS 7.0" because `package.json` pins `typescript ^7.0.2` while `eslint-config-next` bundles typescript-eslint, which needs TypeScript 6.x. Fixing it means changing `dependencies`/`devDependencies` versions or `eslint.config.mjs`, which are outside the ops scope. Suggested fix for the other session: pin `typescript` to `~6.0` (or wait for typescript-eslint support) . The CI workflow runs lint as written; it will stay red until this is fixed.

## Progress

* [x] Unit tests: schedule, schemas, logger, crypto, env (204 unit tests pass in total).
* [x] Error pages (`error.tsx`, `global-error.tsx`, `not-found.tsx`, `(app)/error.tsx`, `(app)/loading.tsx`), `src/components/errors/**`, `/api/health` (+ unit test), `src/instrumentation.ts`.
* [x] Scripts: `create-owner`, `seed-demo` (refuses production; tested guard logic), `smoke` (new `npm run smoke`), shared helpers in `scripts/lib/**`. Extra unit tests in `tests/unit/scripts.test.ts` and `tests/unit/health.test.ts`.
  * **Not run against a real database**: this build environment has no Docker daemon, so `supabase start` is unavailable. `create-owner` and `seed-demo` were type-checked and the production guard was exercised, but the inserts have not been executed. First thing to do locally: `npm run db:start && npm run db:reset && npm run seed:demo`.
  * `smoke` expects a public `/health` on the worker (200 when up) and that `/api/cron/tick` returns 401/403 without the bearer secret. Please confirm both in the other session's code.
