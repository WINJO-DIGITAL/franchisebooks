# Database

Supabase Postgres. The whole schema lives in `supabase/migrations/` and is
applied in file-name order by `npm run db:start` / `db:reset` locally and by
`supabase db push` in production. Regenerate the TypeScript types with
`npm run db:types` after any change.

| Migration | Contents |
| --- | --- |
| `…000100_schema.sql` | Tables, constraints, indexes |
| `…000200_guards_and_audit.sql` | Triggers that protect money rows, and the audit log |
| `…000300_security.sql` | Row Level Security policies and role grants |
| `…000400_functions.sql` | The only routes for sensitive writes (database functions) |
| `…000500_storage.sql` | Private storage buckets |

## Tables at a glance

| Group | Tables | Notes |
| --- | --- | --- |
| People | `accounts`, `user_profiles`, `user_franchise_access` | One account (business) per user. Roles: owner, manager, viewer |
| Setup | `franchises`, `app_settings`, `expense_categories` | FD numbers are stored upper-case, exactly as on DPD documents |
| Drivers | `drivers`, `driver_aliases`, `driver_assignments` | Drivers have a stable id; names can change. Aliases are every name a driver has appeared under |
| Imports | `import_jobs`, `imported_files`, `sync_logs`, `review_items` | Every source document is kept with its SHA-256 hash and outcome |
| Money | `daily_earnings`, `earnings_adjustments`, `driver_cover_records`, `revenue_entries`, `fuel_transactions`, `expenses`, `expense_allocations` | See the rules below |
| Insight | `anomalies`, `monthly_reports` | Informational; never change a figure |
| Integrations | `integration_connections`, `integration_folders`, `app_private.integration_secrets` | Tokens are encrypted by the app and live in a schema users cannot read |
| Trail | `audit_logs` | Append-only: who changed what, and when |

## Safety rules the database enforces itself

These hold for everyone, including the server's own service key, so a bug in
the app cannot break them.

1. **Imported DPD earnings are read-only.** A row cannot be edited or deleted.
   A later, owner-approved correction marks the old row as replaced
   (`is_current = false`) and keeps it for history.
2. **Money rows are never deleted.** Fuel, expenses, revenue, allocations,
   cover records and imported files can only be *voided* (with a reason).
   Amounts, dates and sources of a stored cost cannot change.
3. **Pay adjustments are an append-only ledger.** To undo one, a reversing
   entry is added; nothing is edited.
4. **Duplicates cannot happen.** The same document bytes are stored once
   (`unique (account_id, sha256)`); the same cost has one `dedupe_key`; only
   one *current* earnings row exists per driver, franchise, day and route;
   only one queued/running job exists per type, franchise and date.
5. **A different value for something already stored goes to review**, it is
   never silently overwritten.
6. **Sensitive writes go through functions** (`create_pay_adjustment`,
   `record_driver_cover`, `ingest_earnings`, …) that check permissions and
   write the audit trail in one transaction.

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
