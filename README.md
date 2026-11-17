# Franchise Manager

Daily management for multi-route delivery franchises (built for DPD franchise
owners). It collects driver earnings, fuel and expenses from the DPD partner
portal, Dropbox and manual uploads; keeps every figure traceable to the
original document; and shows the owner, in plain English, what each driver,
route and franchise earned and cost.

* **Web app** — Next.js (App Router), TypeScript, Tailwind. Runs on Vercel.
* **Database, sign-in and files** — Supabase (Postgres, Auth, Storage).
* **Worker** — a small Docker service running Playwright/Chromium that reads
  the DPD portal (read-only). Runs on Fly.io, Railway, Render or any Docker host.
* **Tests** — Vitest (unit, database, integration), Playwright (end to end, accessibility).

## What it does

* **Dashboard**: today, this month, franchise comparison, drivers, alerts, sync status.
* **Drivers**: join/leave, assignments, per-driver performance, earnings history, attributed costs.
* **Earnings**: daily and monthly, original DPD figures beside adjustments and final pay.
* **Fuel & Expenses**: imported or hand-entered, attributed only when it can be done reliably.
* **Adjustments**: guided pay adjustments and driver cover; append-only, reversible by correcting entry.
* **Reports**: monthly PDF per franchise or consolidated; CSV exports.
* **Data & Integrations**: DPD portal (read-only), Dropbox, drag-and-drop upload, review queue.
* **Settings**: franchises, revenue, schedule (UK time), alert levels, categories.

## Quick start (local)

You need Node 22 or newer and Docker (for the local Supabase).

```bash
npm install
npm run db:start                 # starts local Supabase and applies every migration
cp .env.example .env.local       # then paste in the URL and keys that db:start printed
npm run seed:demo                # optional: synthetic demo business (see below)
npm run dev                      # http://localhost:3000
```

The demo business is entirely synthetic. Sign in with `demo@example.test` / `demo-password-123`.

To sign in with your own account instead of the demo one:

```bash
npm run create-owner -- --email you@example.com
```

Public sign-up is off. The owner account is always created with this script
(or by an invitation). On first sign-in you are asked for your business name.

Stop everything with `npm run db:stop`. Start again from nothing with
`npm run db:reset` (local only; financial records cannot be deleted any other way).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Run, build, serve the web app |
| `npm run typecheck` / `lint` | Static checks |
| `npm test` | Unit tests (fast, no database) |
| `npm run test:db` | Database security and financial-rule tests (needs local Supabase) |
| `npm run test:integration` | Import pipeline end to end (needs local Supabase) |
| `npm run test:e2e` | Browser tests (needs local Supabase and `npm run build` first) |
| `npm run test:all` | Every Vitest suite |
| `npm run seed:demo` | Adds synthetic demo data. Refuses to run against production |
| `npm run create-owner` | Creates the owner's sign-in |
| `npm run smoke -- <url>` | Read-only checks of a live site |
| `npm run worker` | Runs the background worker locally |
| `npm run dpd:discover` | Maps the DPD portal (needs DPD credentials on the worker) |
| `npm run db:types` | Regenerates `src/lib/supabase/database.types.ts` |

## Where things are

| Read this | When |
| --- | --- |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Putting it live: Vercel, worker, Supabase, cron, Dropbox, DPD |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Something has gone wrong (sync failed, Dropbox disconnected, DPD changed) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the pieces fit together |
| [`docs/FINANCE.md`](docs/FINANCE.md) | How every number is worked out |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Tables, safety rules and permissions |
| [`docs/DISCOVERY.md`](docs/DISCOVERY.md) | What is known and unknown about the DPD portal |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Build status and what is blocked |
| [`docs/OPS_NOTES.md`](docs/OPS_NOTES.md) | Testing, deployment tooling and known gaps |

## Ground rules

* No secrets in code, logs or the database. Credentials come from environment
  variables; stored connection tokens are encrypted.
* The DPD portal is only ever read, never changed (enforced in code).
* Figures are never guessed. If something cannot be worked out it is shown as
  unavailable, not as zero.
* Demo and test data are synthetic. Never load real driver data into tests.
