# Architecture

## Overview

```
                         ┌────────────────────────────────────────────┐
   Owner (browser /      │  Web app — Next.js on Vercel               │
   phone)  ─────────────▶│  • pages (server components)               │
                         │  • server actions (validated with Zod)     │
                         │  • /api/cron/tick      (Vercel Cron)       │
                         │  • /api/dropbox/*      (OAuth + webhook)   │
                         │  • /api/reports/*      (PDF / CSV)         │
                         └───────┬───────────────────────┬────────────┘
                                 │ user session (RLS)    │ service role (server only)
                                 ▼                       ▼
                         ┌────────────────────────────────────────────┐
                         │  Supabase                                  │
                         │  • Postgres: data, RLS, audit, job queue   │
                         │  • Auth: sign-in                           │
                         │  • Storage: original documents, reports    │
                         └───────▲────────────────────────────────────┘
                                 │ service role
   ┌──────────────────┐  poke   ┌┴───────────────────────────────────────┐
   │ Vercel (web app) │────────▶│  Worker — Node + Playwright (Docker)   │
   └──────────────────┘ Bearer  │  • claims jobs from the queue          │
                                │  • DPD portal: login, navigate,        │──▶ DPD partner portal
                                │    download (READ-ONLY, guarded)       │    (read only)
                                │  • runs the same scheduler tick        │
                                └────────────────────────────────────────┘
```

Two deployables share one codebase:

| Part | Runs on | Why |
| --- | --- | --- |
| **Web app** (`src/`) | Vercel | UI, sign-in, quick server work, Dropbox, reports, cron entry point |
| **Worker** (`worker/`) | GitHub Actions by default; any Docker host otherwise | Headless Chromium for the DPD portal: needs system libraries, long run times and a stable process — none of which suit serverless functions |

The DPD credentials exist **only** on the worker. The web app never sees them.

## Code map

```
src/lib/money.ts            integer-pence money; parsing and UK formatting
src/lib/dates.ts            ISO business dates; UK timezone and formatting
src/lib/finance/calc.ts     ALL accounting formulas (pure, tested)
src/lib/anomalies/          detect.ts (pure rules) · run.ts (database glue)
src/lib/ingest/             extract → columns → parse → match → pipeline
src/lib/dpd/                portal automation: guard, session, discovery, sync
src/lib/dropbox/            OAuth, API client, folder sync, webhook check
src/lib/jobs/               queue helpers, scheduler tick, job runners
src/lib/reports/            monthly report data, PDF, CSV
src/lib/data/               paged database readers shared by pages and jobs
src/lib/supabase/           clients (user session / service role) + types
src/app/                    pages, server actions, API routes
src/components/             the design system and screen components
worker/                     worker entry point + Dockerfile
supabase/migrations/        schema, guards + audit, RLS, functions, storage
tests/                      unit · db · integration · e2e (+ synthetic fixtures)
```

## The import pipeline (one path for every source)

A document from the **DPD portal**, **Dropbox** or a **manual upload** goes
through exactly the same function, `importDocument`:

1. **Hash** the bytes (SHA-256). Same bytes already received → *duplicate*,
   nothing happens.
2. **Keep the original** in private storage and record it in `imported_files`.
3. **Extract** text/tables (PDF with positions, CSV, Excel).
4. **Parse** by column headings into earnings / fuel / expense rows. Every
   unreadable value is an issue, never a zero. The document gets a
   **confidence score**, cross-checked against its own totals line.
5. **Decide**: below the threshold, unknown type, or no franchise →
   **review queue**; nothing is stored until the owner approves.
6. **Match** franchise (by FD number in the document) and drivers (DPD
   reference, then name/alias; ambiguous → left unmatched).
7. **Store** through a transactional database function:
   new row → insert · identical row → skip · *different* row → conflict for
   review (never overwritten).
8. **Scan for anomalies** over the affected dates.
9. Write a **plain-English log line** for the owner.

## Jobs and scheduling

* `import_jobs` is the queue. A unique index allows only one queued/running
  job per (type, franchise, report date), so a schedule, a retry and a manual
  "Sync now" can never overlap.
* Workers claim jobs with `FOR UPDATE SKIP LOCKED`. Failed jobs are re-queued
  on the same row with exponential backoff; crashed jobs are detected and
  released. Because imports are idempotent, a retry cannot duplicate data.
* The **scheduler tick** runs from Vercel Cron and from the worker's own
  timer. It compares the UK wall-clock time with the configured sync time, so
  the schedule follows GMT/BST automatically.

## Security model

* **Auth**: Supabase Auth (email + password). Public sign-up is off by
  default; the owner account is created with `npm run create-owner` or an
  invite.
* **Row Level Security** on every table, forced. A user belongs to one
  account; managers can be limited to specific franchises; viewers are
  read-only; the anonymous role can do nothing.
* **Financial writes** go through database functions or insert-only policies.
  Ledgers are append-only at trigger level — this holds even for the service
  role.
* **Service role key** is used only server-side (import pipeline, cron,
  worker) and is never sent to the browser.
* **Secrets**: OAuth tokens are AES-256-GCM encrypted by the app and stored
  in a schema end users cannot read. Logs redact credentials.
* **Machine endpoints** (cron, worker, Dropbox webhook) verify a bearer
  secret or an HMAC signature with constant-time comparison.
* **Audit log**: database triggers record who changed what on every
  financially relevant table; the log itself is append-only.

See also: `DATABASE.md`, `FINANCE.md`, `DEPLOYMENT.md`, `DISCOVERY.md`.

## Portal change warning
- A DPD read that fails because a page does not look as the portal map expects is logged with `kind: layout` and the failing `step`. At the end of each scheduler tick `checkPortalDrift` (src/lib/jobs/portal-drift.ts) counts those in the last 24 hours. Three or more failed reads, across more than one account or at the same step, raise one email to `ALERT_EMAIL` (at most every six hours) saying the shared portal map may need updating. The rule is the pure `assessPortalDrift` in src/lib/dpd/drift.ts.

## Team members
- Owner only, in Settings: `inviteTeamMember`, `updateTeamMember` and `removeTeamMember` (src/lib/actions/team.ts). An invite emails a link to set a password (same route as driver invites), creates the `user_profiles` row and, for limited members, `user_franchise_access` rows, using the service role after checking the caller is the owner. Members share the owner's subscription. Removing someone deletes their login; if records they entered still carry their id (adjustments, cover) the login is blocked and their profile removed instead.
