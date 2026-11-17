# Database

PostgreSQL on Supabase. Migrations in `supabase/migrations/` (apply with `npx supabase db push`).

| Migration | Contents |
| --- | --- |
| `…0100_schema.sql` | tables, constraints, indexes |
| `…0200_guards_and_audit.sql` | append-only / read-only triggers, audit triggers |
| `…0300_security.sql` | grants, row level security policies |
| `…0400_functions.sql` | transactional operations (adjustments, cover, imports, job queue, secrets) |
| `…0500_storage.sql` | private storage buckets |

## Tables

**Business and people** — `accounts` (the tenant), `user_profiles` (role: owner/manager/viewer; optional per-franchise access via `user_franchise_access`), `app_settings`, `franchises` (UUID key; `fd_number` is a business identifier, unique per account), `drivers` (stable UUID; names can change), `driver_aliases` (every spelling seen on reports), `driver_assignments` (franchise / route / vehicle over time).

**Money in** — `daily_earnings` (imported DPD figures; `is_current` + `superseded_by` keep replaced rows), `revenue_entries` (franchise revenue, confirmed/estimated).

**Pay changes** — `earnings_adjustments` (append-only ledger; `reverses_adjustment_id` links a reversal), `driver_cover_records` (the agreed allocation, stored separately from DPD figures).

**Costs** — `fuel_transactions`, `expenses`, `expense_categories`, `expense_allocations` (who a cost is attributed to; history kept via `is_current`).

**Imports and operations** — `imported_files` (every source document: SHA-256, origin, outcome; unique per account+hash), `import_jobs` (durable queue; a unique index prevents overlapping jobs per type/franchise/date), `sync_logs`, `review_items` (things awaiting a decision), `integration_connections`, `integration_folders`, `app_private.integration_secrets` (encrypted tokens; not readable by users).

**Insight** — `anomalies` (explainable alerts with owner status), `monthly_reports`, `audit_logs` (append-only).

## Guarantees enforced in the database

* No table is readable by the anonymous role. RLS is enabled **and forced** on every table (tested).
* A user sees only their own account's rows; a limited manager only their franchises' rows (tested).
* `daily_earnings` figures, `earnings_adjustments` and `audit_logs` cannot be updated or deleted by anyone, including the service role.
* Costs, revenue, covers, files and allocations cannot be deleted; amounts on costs/revenue cannot change after insert (void and re-enter instead).
* Imports are idempotent: the same bytes are stored once; the same driver-day is inserted once; a *different* figure for the same driver-day becomes a review item and never overwrites.
* Pay adjustments: sign must match type; a reason is required; an entry can be reversed once; cover-linked entries can only be reversed by cancelling the cover.

## Audit

Row-level triggers write to `audit_logs` (who, what, before/after) for adjustments, cover, drivers, assignments, franchises, allocations, categories, revenue, integrations, settings, profiles, manual imports/entries and decisions on alerts and review items.

## Who can see what (Row Level Security)

* Row Level Security is on, and forced, for every table.
* A user sees only their own account's rows.
* Managers and viewers can be limited to named franchises
  (`user_profiles.all_franchises = false` plus `user_franchise_access`).
* Viewers are read-only. The anonymous (signed-out) role can do nothing.
* Storage buckets (`source-documents`, `reports`, `diagnostics`) are private
  and have no end-user policies. The server checks access, then hands out
  short-lived signed links.

## Backups and recovery

* Production: enable daily backups in Supabase (Pro plan includes them, and
  Point-in-Time Recovery is an add-on). Check **Database → Backups** in the
  dashboard after setting the project up.
* Source documents are the ultimate record: every figure can be re-imported
  from them. Do not empty the `source-documents` bucket.
* Because money rows cannot be deleted, a bad import is fixed by voiding or
  reviewing, not by deleting. Locally, `npm run db:reset` starts clean.

## Row limits

The Supabase Data API returns at most 1,000 rows per request. Anything that
feeds a total is read page by page (`src/lib/data/fetch-all.ts`); never add a
financial query that skips this.
