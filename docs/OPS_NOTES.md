# Operations and QA notes

Where the testing, deployment tooling and operational scripts stand. (This file began on the
`ops-qa` branch; it was rewritten after that work was merged and verified together with the application.)

## What was merged from `ops-qa`

| Area | What it brought | State |
| --- | --- | --- |
| Error handling | `error.tsx`, `global-error.tsx`, `not-found.tsx`, loading states, `/api/health` (checks the database), `instrumentation.ts` | In use, tested |
| Scripts | `create-owner` (private password prompt), `smoke` (read-only live-site checks), production guard for demo data | In use; `create-owner` and `smoke` exercised locally |
| Deploy configs | `deploy/worker/Dockerfile` (the single worker Dockerfile), `fly.toml`, `railway.json`, `render.yaml`, `.dockerignore` | Worker command verified locally; see below for the image build |
| CI | `.github/workflows/ci.yml`: lint, types, unit; database + integration; browser tests; worker image build | Not yet run on GitHub |
| Browser tests | Accessibility (axe, WCAG AA), navigation, responsive at 320/390/1280, auth, onboarding, password reset | Run and passing |
| Docs | `RUNBOOK.md`, `DEPLOYMENT.md`, extra sections in `DATABASE.md` / `FINANCE.md`, `README.md` | Merged; button names corrected against the real screens |
| Tooling | `typescript` pinned to `~6.0` (typescript-eslint rejects 7), postcss config lint fix | `npm run lint` is clean |

Decisions where both branches built the same thing:

* **Seed/demo data**: kept the application branch's `seed-demo` (it uses the real import pipeline and was run against the database), with the ops branch's production guard added to it.
* **Worker Dockerfile**: kept `deploy/worker/Dockerfile`; removed the duplicate in `worker/`.
* **Browser tests**: both suites kept. Generic specs run as a brand-new throw-away owner; the "journeys" run as the seeded demo owner on realistic data (see `playwright.config.ts`).
* **`vercel.json`**: kept the application branch's (London region, 5-minute cron, long function limits).

## Problems the combined testing found and fixed

* Password-reset links ended on the sign-in page: the local Supabase redirect allow-list did not match, the link was built from a fixed `APP_URL` (so the PKCE cookie belonged to another host), and the link handler redirected to the wrong host. Now `/auth/reset` is an exact allow-listed path, the link uses the address the person is on, and the redirect is relative.
* Error messages were inside the field `<label>`, so a field's accessible name included its error text. Moved out.
* Forms emptied themselves after a validation error. Values are now restored (never passwords or files).
* Header and toolbar overflowed at 320px wide on every page; fixed.
* "Sign out" signed the user out of every device; now this device only.
* Local Supabase sign-up is now off, matching production.

## Running everything

```
npm run db:start            # needs Docker
cp .env.example .env.local  # paste the printed keys
npm run build
npm run lint && npm run typecheck
npm test                    # unit
npm run test:db && npm run test:integration
npm run test:e2e            # starts the app on :3000, seeds the demo business
npm run smoke -- http://127.0.0.1:3000
```

## Still not exercised anywhere

* The GitHub Actions workflow itself (it has never run on GitHub).
* Real DPD portal, real Dropbox, a production Supabase project, Vercel, a hosted worker (see DEVELOPMENT.md).
* Vercel's Hobby plan only allows daily cron jobs; the 5-minute schedule needs Pro (or rely on the worker's own timer), see `docs/DEPLOYMENT.md`.
