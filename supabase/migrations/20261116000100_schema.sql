-- ════════════════════════════════════════════════════════════════════════════
-- DPD Franchise Manager — core schema
--
-- Conventions
--   • Internal primary keys are UUIDs. The DPD "FD number" is a business
--     identifier (franchises.fd_number), never a primary key.
--   • Money is numeric(12,2) pounds. Unit rates are numeric(10,4).
--   • Calendar dates are `date` (UK business dates); instants are timestamptz.
--   • Imported DPD figures are never edited. Corrections are new rows
--     (pay adjustments, superseding imports), so history is always preserved.
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists app_private;
comment on schema app_private is 'Internal helpers. Not exposed through the Data API.';

-- ── Accounts and people ─────────────────────────────────────────────────────

create table public.accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  created_at  timestamptz not null default now()
);
comment on table public.accounts is 'A franchise business (the tenant). Everything else belongs to one account.';

create table public.user_profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  account_id      uuid not null references public.accounts (id) on delete restrict,
  full_name       text not null default '',
  role            text not null default 'viewer' check (role in ('owner', 'manager', 'viewer')),
  all_franchises  boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on column public.user_profiles.all_franchises is 'When false the user only sees franchises listed in user_franchise_access.';
create index user_profiles_account_idx on public.user_profiles (account_id);

create table public.franchises (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete restrict,
  fd_number   text not null check (fd_number = upper(btrim(fd_number)) and length(fd_number) between 1 and 40),
  name        text not null default '',
  depot       text,
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (account_id, fd_number),
  unique (id, account_id)
);
comment on column public.franchises.fd_number is 'DPD franchise identifier exactly as it appears on DPD documents (upper-cased, trimmed).';

create table public.user_franchise_access (
  user_id       uuid not null references public.user_profiles (id) on delete cascade,
  franchise_id  uuid not null references public.franchises (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, franchise_id)
);

create table public.app_settings (
  account_id                uuid primary key references public.accounts (id) on delete cascade,
  sync_enabled              boolean not null default true,
  sync_time_local           time not null default '20:30',
  sync_timezone             text not null default 'Europe/London',
  revenue_allocation_basis  text not null default 'none'
                            check (revenue_allocation_basis in ('none', 'stops', 'parcels', 'earnings')),
  anomaly_config            jsonb not null default '{}'::jsonb,
  auto_monthly_reports      boolean not null default true,
  updated_at                timestamptz not null default now(),
  updated_by                uuid references auth.users (id) on delete set null
);
comment on column public.app_settings.sync_time_local is 'Local wall-clock time (in sync_timezone) after which the evening DPD sync is queued.';

-- ── Drivers ─────────────────────────────────────────────────────────────────

create table public.drivers (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete restrict,
  display_name    text not null check (length(btrim(display_name)) between 1 and 120),
  dpd_driver_ref  text,
  phone           text,
  email           text,
  notes           text,
  start_date      date,
  leaving_date    date,
  is_active       boolean not null default true,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (leaving_date is null or start_date is null or leaving_date >= start_date),
  unique (id, account_id)
);
comment on table public.drivers is 'Drivers have a stable internal id. Names can change without affecting history.';
comment on column public.drivers.dpd_driver_ref is 'Driver identifier used by DPD, where the reports provide one.';
create index drivers_account_idx on public.drivers (account_id, is_active);
create unique index drivers_dpd_ref_uniq on public.drivers (account_id, dpd_driver_ref) where dpd_driver_ref is not null;

create table public.driver_aliases (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete restrict,
  driver_id        uuid not null,
  alias_normalised text not null check (alias_normalised = lower(btrim(alias_normalised)) and alias_normalised <> ''),
  alias_display    text not null,
  created_at       timestamptz not null default now(),
  foreign key (driver_id, account_id) references public.drivers (id, account_id) on delete cascade,
  unique (account_id, driver_id, alias_normalised)
);
comment on table public.driver_aliases is 'Every name a driver has appeared under in source reports. Used to match imported rows to drivers.';
create index driver_aliases_lookup_idx on public.driver_aliases (account_id, alias_normalised);

create table public.driver_assignments (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts (id) on delete restrict,
  driver_id             uuid not null,
  franchise_id          uuid not null,
  route                 text,
  vehicle_registration  text check (vehicle_registration is null or vehicle_registration = upper(replace(vehicle_registration, ' ', ''))),
  start_date            date not null,
  end_date              date,
  notes                 text,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  foreign key (driver_id, account_id) references public.drivers (id, account_id) on delete restrict,
  foreign key (franchise_id, account_id) references public.franchises (id, account_id) on delete restrict
);
comment on table public.driver_assignments is 'Which franchise (and optionally route / vehicle) a driver works on, and when.';
create index driver_assignments_driver_idx on public.driver_assignments (driver_id, start_date);
create index driver_assignments_franchise_idx on public.driver_assignments (franchise_id, start_date);
create index driver_assignments_vehicle_idx on public.driver_assignments (account_id, vehicle_registration) where vehicle_registration is not null;

-- ── Imports, jobs and logs ──────────────────────────────────────────────────

create table public.import_jobs (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts (id) on delete restrict,
  franchise_id   uuid references public.franchises (id) on delete restrict,
  job_type       text not null check (job_type in ('dpd_sync', 'dpd_discovery', 'dropbox_sync', 'file_import', 'anomaly_scan', 'monthly_report')),
  report_date    date,
  status         text not null default 'queued'
                 check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'blocked', 'cancelled')),
  trigger        text not null default 'manual' check (trigger in ('schedule', 'manual', 'webhook', 'retry')),
  payload        jsonb not null default '{}'::jsonb,
  attempts       integer not null default 0,
  max_attempts   integer not null default 3 check (max_attempts between 1 and 10),
  run_after      timestamptz not null default now(),
  locked_at      timestamptz,
  locked_by      text,
  started_at     timestamptz,
  finished_at    timestamptz,
  result         jsonb,
  error_message  text,
  error_detail   jsonb,
  requested_by   uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
comment on table public.import_jobs is 'Durable job queue for synchronisation and import work.';
comment on column public.import_jobs.error_message is 'Plain-English explanation shown to the owner. Technical detail lives in error_detail.';
-- Prevent overlapping jobs for the same franchise and reporting date.
create unique index import_jobs_no_overlap on public.import_jobs (
  account_id, job_type,
  coalesce(franchise_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(report_date, '1900-01-01'::date)
) where status in ('queued', 'running');
create index import_jobs_queue_idx on public.import_jobs (status, run_after) where status = 'queued';
create index import_jobs_recent_idx on public.import_jobs (account_id, created_at desc);

create table public.imported_files (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts (id) on delete restrict,
  franchise_id       uuid references public.franchises (id) on delete restrict,
  source             text not null check (source in ('dpd_portal', 'dropbox', 'manual_upload')),
  source_ref         text,
  original_filename  text not null,
  mime_type          text,
  byte_size          bigint not null check (byte_size >= 0),
  sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path       text,
  document_type      text not null default 'unknown'
                     check (document_type in ('earnings_report', 'fuel_report', 'expense_report', 'unknown')),
  report_date_from   date,
  report_date_to     date,
  status             text not null default 'received'
                     check (status in ('received', 'processing', 'imported', 'needs_review', 'failed', 'ignored')),
  parser             text,
  parse_confidence   numeric(4,3) check (parse_confidence is null or parse_confidence between 0 and 1),
  records_found      integer not null default 0,
  records_imported   integer not null default 0,
  records_unchanged  integer not null default 0,
  status_message     text,
  error_detail       jsonb,
  import_job_id      uuid references public.import_jobs (id) on delete set null,
  uploaded_by        uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  processed_at       timestamptz,
  -- The same document (byte-for-byte) is only ever stored and imported once.
  unique (account_id, sha256)
);
comment on table public.imported_files is 'Every source document received, with its content hash, origin and processing outcome.';
create index imported_files_recent_idx on public.imported_files (account_id, created_at desc);
create index imported_files_status_idx on public.imported_files (account_id, status);

create table public.sync_logs (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts (id) on delete cascade,
  integration    text not null check (integration in ('dpd', 'dropbox', 'upload', 'system')),
  import_job_id  uuid references public.import_jobs (id) on delete set null,
  franchise_id   uuid references public.franchises (id) on delete set null,
  level          text not null default 'info' check (level in ('info', 'warning', 'error')),
  event          text not null,
  message        text not null,
  detail         jsonb,
  created_at     timestamptz not null default now()
);
comment on column public.sync_logs.message is 'Plain-English message for the owner.';
create index sync_logs_recent_idx on public.sync_logs (account_id, created_at desc);
create index sync_logs_integration_idx on public.sync_logs (account_id, integration, created_at desc);

create table public.integration_connections (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts (id) on delete cascade,
  provider         text not null check (provider in ('dropbox', 'dpd')),
  status           text not null default 'disconnected'
                   check (status in ('connected', 'needs_reconnect', 'disconnected', 'error')),
  display_name     text,
  external_account_id text,
  config           jsonb not null default '{}'::jsonb,
  last_sync_at     timestamptz,
  last_success_at  timestamptz,
  last_error       text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, provider)
);
comment on table public.integration_connections is 'Connection status for external services. Secrets are held separately in app_private.integration_secrets.';

-- OAuth tokens: encrypted by the application (AES-256-GCM) and never readable by end users.
create table app_private.integration_secrets (
  connection_id   uuid primary key references public.integration_connections (id) on delete cascade,
  ciphertext      text not null,
  updated_at      timestamptz not null default now()
);

create table public.integration_folders (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts (id) on delete cascade,
  connection_id        uuid not null references public.integration_connections (id) on delete cascade,
  path_display         text not null,
  path_lower           text not null,
  default_franchise_id uuid references public.franchises (id) on delete set null,
  cursor               text,
  last_checked_at      timestamptz,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (connection_id, path_lower)
);
comment on table public.integration_folders is 'Dropbox folders being watched, with the incremental sync cursor for each.';

-- ── Earnings ────────────────────────────────────────────────────────────────

create table public.daily_earnings (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts (id) on delete restrict,
  franchise_id          uuid not null,
  driver_id             uuid,
  source_driver_name    text not null,
  source_driver_ref     text,
  driver_key            text not null check (driver_key <> ''),
  report_date           date not null,
  route                 text,
  parcels               integer check (parcels is null or parcels >= 0),
  stops                 integer check (stops is null or stops >= 0),
  pay_per_parcel        numeric(10,4) check (pay_per_parcel is null or pay_per_parcel >= 0),
  pay_per_stop          numeric(10,4) check (pay_per_stop is null or pay_per_stop >= 0),
  gross_earnings        numeric(12,2) not null,
  deductions            numeric(12,2) not null default 0 check (deductions >= 0),
  additional_payments   numeric(12,2) not null default 0 check (additional_payments >= 0),
  net_earnings          numeric(12,2),
  -- The figure treated as "original DPD earnings": the net supplied by DPD, or
  -- gross − deductions + additional payments when DPD does not state a net.
  original_earnings     numeric(12,2) generated always as
                        (coalesce(net_earnings, gross_earnings - deductions + additional_payments)) stored,
  imported_file_id      uuid not null references public.imported_files (id) on delete restrict,
  source                text not null check (source in ('dpd_portal', 'dropbox', 'manual_upload')),
  extraction_confidence numeric(4,3) check (extraction_confidence is null or extraction_confidence between 0 and 1),
  extracted_at          timestamptz not null default now(),
  is_current            boolean not null default true,
  superseded_by         uuid references public.daily_earnings (id) on delete restrict,
  superseded_at         timestamptz,
  superseded_reason     text,
  created_at            timestamptz not null default now(),
  foreign key (franchise_id, account_id) references public.franchises (id, account_id) on delete restrict,
  foreign key (driver_id, account_id) references public.drivers (id, account_id) on delete restrict,
  check ((is_current and superseded_at is null) or (not is_current))
);
comment on table public.daily_earnings is 'Driver earnings exactly as imported from DPD documents. Read-only after import.';
comment on column public.daily_earnings.driver_key is 'Stable key for the driver as named by the source: the DPD driver ref when present, otherwise the normalised name.';
comment on column public.daily_earnings.driver_id is 'Null until the row has been matched to a registered driver.';
comment on column public.daily_earnings.is_current is 'False when a later, owner-approved import replaced this row. Replaced rows are kept for history.';
-- One current figure per driver, franchise, day and route.
create unique index daily_earnings_current_uniq on public.daily_earnings
  (franchise_id, driver_key, report_date, coalesce(route, '')) where is_current;
create index daily_earnings_date_idx on public.daily_earnings (account_id, report_date) where is_current;
create index daily_earnings_driver_idx on public.daily_earnings (driver_id, report_date) where is_current;
create index daily_earnings_franchise_idx on public.daily_earnings (franchise_id, report_date) where is_current;
create index daily_earnings_file_idx on public.daily_earnings (imported_file_id);

create table public.driver_cover_records (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts (id) on delete restrict,
  franchise_id          uuid not null,
  cover_date            date not null,
  original_driver_id    uuid not null,
  covering_driver_id    uuid not null,
  route                 text,
  notes                 text,
  earnings_allocation   text not null default 'none' check (earnings_allocation in ('none', 'all_to_cover', 'custom')),
  amount_to_covering    numeric(12,2) not null default 0 check (amount_to_covering >= 0),
  amount_from_original  numeric(12,2) not null default 0 check (amount_from_original >= 0),
  expense_attribution   text not null default 'original' check (expense_attribution in ('original', 'covering', 'franchise')),
  status                text not null default 'active' check (status in ('active', 'cancelled')),
  cancelled_at          timestamptz,
  cancelled_by          uuid references auth.users (id) on delete set null,
  cancel_reason         text,
  created_by            uuid not null references auth.users (id) on delete restrict,
  created_at            timestamptz not null default now(),
  check (original_driver_id <> covering_driver_id),
  foreign key (franchise_id, account_id) references public.franchises (id, account_id) on delete restrict,
  foreign key (original_driver_id, account_id) references public.drivers (id, account_id) on delete restrict,
  foreign key (covering_driver_id, account_id) references public.drivers (id, account_id) on delete restrict
);
comment on table public.driver_cover_records is 'A record that one driver covered another, with the pay allocation the owner agreed. DPD figures are untouched.';
comment on column public.driver_cover_records.amount_to_covering is 'Agreed amount added to the covering driver''s pay (stored as a linked pay adjustment).';
comment on column public.driver_cover_records.amount_from_original is 'Agreed amount taken off the original driver''s pay (stored as a linked pay adjustment).';
create index driver_cover_date_idx on public.driver_cover_records (account_id, cover_date);

create table public.earnings_adjustments (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null references public.accounts (id) on delete restrict,
  franchise_id            uuid not null,
  driver_id               uuid not null,
  earnings_date           date not null,
  adjustment_type         text not null check (adjustment_type in
                          ('additional_payment', 'deduction', 'withheld_payment', 'earnings_correction', 'cover_payment', 'other')),
  -- Signed effect on the driver's pay: positive adds, negative deducts, zero records a decision.
  amount                  numeric(12,2) not null check (amount between -100000 and 100000),
  reason                  text not null check (length(btrim(reason)) >= 3),
  cover_record_id         uuid references public.driver_cover_records (id) on delete restrict,
  reverses_adjustment_id  uuid references public.earnings_adjustments (id) on delete restrict,
  created_by              uuid not null references auth.users (id) on delete restrict,
  created_at              timestamptz not null default now(),
  foreign key (franchise_id, account_id) references public.franchises (id, account_id) on delete restrict,
  foreign key (driver_id, account_id) references public.drivers (id, account_id) on delete restrict,
  -- Sign must agree with the type (reversal entries mirror the entry they reverse).
  check (
    reverses_adjustment_id is not null
    or (adjustment_type = 'additional_payment' and amount >= 0)
    or (adjustment_type = 'cover_payment' and amount >= 0)
    or (adjustment_type = 'deduction' and amount <= 0)
    or (adjustment_type = 'withheld_payment' and amount <= 0)
    or (adjustment_type in ('earnings_correction', 'other'))
  )
);
comment on table public.earnings_adjustments is 'Append-only ledger of manual pay adjustments. Reversed by a new correcting entry, never edited or deleted.';
-- An adjustment can be reversed at most once.
create unique index earnings_adjustments_reversal_uniq on public.earnings_adjustments (reverses_adjustment_id)
  where reverses_adjustment_id is not null;
create index earnings_adjustments_date_idx on public.earnings_adjustments (account_id, earnings_date);
create index earnings_adjustments_driver_idx on public.earnings_adjustments (driver_id, earnings_date);
create index earnings_adjustments_cover_idx on public.earnings_adjustments (cover_record_id) where cover_record_id is not null;

-- ── Revenue ─────────────────────────────────────────────────────────────────

create table public.revenue_entries (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id) on delete restrict,
  franchise_id      uuid not null,
  period_start      date not null,
  period_end        date not null,
  amount            numeric(12,2) not null check (amount >= 0),
  status            text not null default 'confirmed' check (status in ('confirmed', 'estimated')),
  source            text not null default 'manual' check (source in ('manual', 'dpd_portal', 'document')),
  description       text,
  imported_file_id  uuid references public.imported_files (id) on delete restrict,
  is_void           boolean not null default false,
  void_reason       text,
  voided_by         uuid references auth.users (id) on delete set null,
  voided_at         timestamptz,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  foreign key (franchise_id, account_id) references public.franchises (id, account_id) on delete restrict,
  check (period_end >= period_start),
  -- A revenue entry must sit inside one calendar month so monthly reports never have to apportion it.
  check (date_trunc('month', period_start) = date_trunc('month', period_end))
);
comment on table public.revenue_entries is 'Franchise revenue (what DPD pays the franchise). Kept separate from driver pay. Status says whether the figure is confirmed or an estimate.';
create index revenue_entries_period_idx on public.revenue_entries (account_id, period_start) where not is_void;

-- ── Fuel and expenses ───────────────────────────────────────────────────────

create table public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  kind        text not null default 'other' check (kind in ('fuel', 'vehicle', 'other')),
  is_system   boolean not null default false,
  is_active   boolean not null default true,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  unique (id, account_id)
);
create unique index expense_categories_name_uniq on public.expense_categories (account_id, lower(name));

create table public.fuel_transactions (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts (id) on delete restrict,
  franchise_id          uuid references public.franchises (id) on delete restrict,
  transaction_date      date not null,
  transaction_time      time,
  description           text,
  supplier              text,
  vehicle_registration  text check (vehicle_registration is null or vehicle_registration = upper(replace(vehicle_registration, ' ', ''))),
  source_driver_name    text,
  card_reference        text,
  litres                numeric(10,3) check (litres is null or litres >= 0),
  price_per_litre       numeric(10,4) check (price_per_litre is null or price_per_litre >= 0),
  total_cost            numeric(12,2) not null,
  transaction_ref       text,
  source                text not null check (source in ('dpd_portal', 'dropbox', 'manual_upload', 'manual_entry')),
  imported_file_id      uuid references public.imported_files (id) on delete restrict,
  dedupe_key            text not null,
  is_void               boolean not null default false,
  void_reason           text,
  voided_by             uuid references auth.users (id) on delete set null,
  voided_at             timestamptz,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (account_id, dedupe_key)
);
comment on column public.fuel_transactions.dedupe_key is 'Deterministic key built from the transaction reference (or its details) so repeated imports never duplicate a transaction.';
create index fuel_transactions_date_idx on public.fuel_transactions (account_id, transaction_date);

create table public.expenses (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts (id) on delete restrict,
  franchise_id          uuid references public.franchises (id) on delete restrict,
  category_id           uuid not null,
  expense_date          date not null,
  description           text not null default '',
  supplier              text,
  vehicle_registration  text check (vehicle_registration is null or vehicle_registration = upper(replace(vehicle_registration, ' ', ''))),
  source_driver_name    text,
  amount                numeric(12,2) not null,
  transaction_ref       text,
  source                text not null check (source in ('dpd_portal', 'dropbox', 'manual_upload', 'manual_entry')),
  imported_file_id      uuid references public.imported_files (id) on delete restrict,
  dedupe_key            text not null,
  is_void               boolean not null default false,
  void_reason           text,
  voided_by             uuid references auth.users (id) on delete set null,
  voided_at             timestamptz,
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  foreign key (category_id, account_id) references public.expense_categories (id, account_id) on delete restrict,
  unique (account_id, dedupe_key)
);
create index expenses_date_idx on public.expenses (account_id, expense_date);

create table public.expense_allocations (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts (id) on delete restrict,
  expense_id           uuid references public.expenses (id) on delete restrict,
  fuel_transaction_id  uuid references public.fuel_transactions (id) on delete restrict,
  scope                text not null check (scope in ('driver', 'franchise')),
  driver_id            uuid,
  method               text not null check (method in ('auto_vehicle', 'auto_driver_ref', 'manual')),
  note                 text,
  is_current           boolean not null default true,
  replaced_at          timestamptz,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  foreign key (driver_id, account_id) references public.drivers (id, account_id) on delete restrict,
  check ((expense_id is null) <> (fuel_transaction_id is null)),
  check ((scope = 'driver' and driver_id is not null) or (scope = 'franchise' and driver_id is null))
);
comment on table public.expense_allocations is 'Who a cost is attributed to. A cost with no current allocation is "unallocated". Re-assigning adds a row; earlier rows are kept.';
create unique index expense_allocations_current_expense on public.expense_allocations (expense_id) where is_current and expense_id is not null;
create unique index expense_allocations_current_fuel on public.expense_allocations (fuel_transaction_id) where is_current and fuel_transaction_id is not null;
create index expense_allocations_driver_idx on public.expense_allocations (driver_id) where is_current;

-- ── Review queue, anomalies, reports, audit ─────────────────────────────────

create table public.review_items (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id) on delete cascade,
  franchise_id      uuid references public.franchises (id) on delete set null,
  imported_file_id  uuid references public.imported_files (id) on delete cascade,
  kind              text not null check (kind in
                    ('low_confidence', 'source_conflict', 'validation_failed', 'unknown_document', 'unmatched_franchise', 'extraction_failed')),
  title             text not null,
  detail            text not null default '',
  payload           jsonb not null default '{}'::jsonb,
  dedupe_key        text,
  status            text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  resolved_by       uuid references auth.users (id) on delete set null,
  resolved_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz not null default now()
);
comment on table public.review_items is 'Imports that need a human decision before any figure is stored (low confidence, conflicts between sources, unknown documents).';
create unique index review_items_dedupe_uniq on public.review_items (account_id, dedupe_key) where dedupe_key is not null and status = 'open';
create index review_items_open_idx on public.review_items (account_id, created_at desc) where status = 'open';

create table public.anomalies (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts (id) on delete cascade,
  franchise_id       uuid references public.franchises (id) on delete cascade,
  driver_id          uuid references public.drivers (id) on delete cascade,
  anomaly_type       text not null,
  severity           text not null default 'attention' check (severity in ('info', 'attention', 'urgent')),
  subject_date       date not null,
  title              text not null,
  what_happened      text not null,
  actual_value       text,
  expected_value     text,
  why_flagged        text not null,
  suggested_action   text not null,
  metric             jsonb not null default '{}'::jsonb,
  dedupe_key         text not null,
  status             text not null default 'open'
                     check (status in ('open', 'investigating', 'resolved', 'expected', 'ignored')),
  status_note        text,
  status_changed_by  uuid references auth.users (id) on delete set null,
  status_changed_at  timestamptz,
  auto_resolved      boolean not null default false,
  detected_at        timestamptz not null default now(),
  unique (account_id, dedupe_key)
);
comment on table public.anomalies is 'Things flagged for the owner to look at. Informational only: an anomaly never changes any financial figure.';
create index anomalies_open_idx on public.anomalies (account_id, subject_date desc) where status in ('open', 'investigating');

create table public.monthly_reports (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  franchise_id  uuid references public.franchises (id) on delete cascade,
  report_month  date not null check (report_month = date_trunc('month', report_month)::date),
  trigger       text not null default 'manual' check (trigger in ('auto', 'manual')),
  storage_path  text not null,
  totals        jsonb not null default '{}'::jsonb,
  generated_by  uuid references auth.users (id) on delete set null,
  generated_at  timestamptz not null default now()
);
comment on column public.monthly_reports.franchise_id is 'Null for the consolidated all-franchise report.';
create index monthly_reports_lookup_idx on public.monthly_reports (account_id, report_month desc, generated_at desc);

create table public.audit_logs (
  id            bigint generated always as identity primary key,
  account_id    uuid not null references public.accounts (id) on delete cascade,
  actor_id      uuid,
  actor_type    text not null check (actor_type in ('user', 'system')),
  action        text not null,
  entity_table  text not null,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);
comment on table public.audit_logs is 'Append-only record of who changed what and when.';
create index audit_logs_recent_idx on public.audit_logs (account_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_table, entity_id);
