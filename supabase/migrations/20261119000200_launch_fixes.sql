-- Launch fixes: a dependable nightly sync, error alerts, driver statements, fuel VAT as stated.

-- ── Nightly sync: each time the website asked GitHub to start the sync run ──────────────────────────────────────
-- One row per attempt, per "night" (the UK evening the sync belongs to). The (night, attempt) key stops two scheduler
-- ticks starting the run twice at the same moment.
create table public.sync_dispatches (
  night         date not null,
  attempt       integer not null check (attempt between 1 and 10),
  dispatched_at timestamptz not null default now(),
  started       boolean not null default false,
  message       text,
  primary key (night, attempt)
);
comment on table public.sync_dispatches is 'Each time the scheduler asked GitHub Actions to start the DPD sync. Written only by the server.';
alter table public.sync_dispatches enable row level security;
alter table public.sync_dispatches force row level security;
revoke all on public.sync_dispatches from anon, authenticated;

-- ── Error alerts: rate limit for alert emails ────────────────────────────────────────────────────────────────────
-- An alert with the same key is sent at most once per time bucket (for example one hour).
create table public.alert_log (
  alert_key  text not null check (length(alert_key) <= 200),
  bucket     text not null check (length(bucket) <= 40),
  sent_at    timestamptz not null default now(),
  recipient  text,
  primary key (alert_key, bucket)
);
comment on table public.alert_log is 'Alert emails sent, used to stop the same alert being sent again too soon. Written only by the server.';
alter table public.alert_log enable row level security;
alter table public.alert_log force row level security;
revoke all on public.alert_log from anon, authenticated;

-- ── Drivers: VAT number, self-billing agreement, and a stable number for statements ─────────────────────────────
alter table public.drivers
  add column vat_number text check (vat_number is null or (length(vat_number) between 4 and 20)),
  add column self_billing_agreement boolean not null default false,
  add column statement_no integer check (statement_no is null or statement_no > 0);
create unique index drivers_statement_no_key on public.drivers (account_id, statement_no) where statement_no is not null;
comment on column public.drivers.vat_number is 'The driver''s own VAT registration number, if they have one. When set, their statements show VAT.';
comment on column public.drivers.self_billing_agreement is 'Ticked when the driver has signed a self-billing agreement. Only then is their statement titled "Self-billed invoice".';
comment on column public.drivers.statement_no is 'Stable number used in the driver''s statement numbers (D001). Given on the first statement and never changed.';

-- ── Driver statements: one per driver, franchise and DPD pay period ─────────────────────────────────────────────
create table public.driver_statements (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete restrict,
  franchise_id  uuid not null references public.franchises (id) on delete restrict,
  driver_id     uuid not null references public.drivers (id) on delete restrict,
  period_start  date not null,
  period_end    date not null check (period_end >= period_start),
  statement_no  text not null check (length(statement_no) <= 60),
  title         text not null check (title in ('Driver statement', 'Self-billed invoice')),
  storage_path  text not null,
  totals        jsonb not null default '{}'::jsonb,
  trigger       text not null check (trigger in ('auto', 'manual')),
  generated_by  uuid references auth.users (id) on delete set null,
  generated_at  timestamptz not null default now(),
  emailed_at    timestamptz,
  unique (account_id, statement_no)
);
create index driver_statements_period_idx on public.driver_statements (account_id, period_start);
create index driver_statements_driver_idx on public.driver_statements (driver_id, period_start);
comment on table public.driver_statements is 'A PDF statement of what a driver earned in one DPD pay period at one franchise. Regenerating replaces the file under the same number.';
alter table public.driver_statements enable row level security;
alter table public.driver_statements force row level security;
create policy driver_statements_read on public.driver_statements for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
-- Signed-in users may only read (through the policy above); the server writes.
revoke all on public.driver_statements from anon, authenticated;
grant select on public.driver_statements to authenticated;
create trigger audit after insert or update or delete on public.driver_statements for each row execute function app_private.audit_row();

-- ── Fuel: keep the VAT a fuel file states ────────────────────────────────────────────────────────────────────────
-- Null means the file did not state any VAT, so it is shown as "VAT not stated", never as an amount before VAT.
alter table public.fuel_transactions
  add column vat_amount numeric(12, 2) check (vat_amount is null or vat_amount >= 0);
alter table public.fuel_transactions
  add column vat_basis text check (vat_basis is null or vat_basis in ('net', 'gross', 'not_stated'));
comment on column public.fuel_transactions.vat_amount is 'VAT stated by the fuel file for this row. Null when the file states none.';
comment on column public.fuel_transactions.vat_basis is 'What the amount is: net = before VAT; gross = the file says it includes VAT (not split out); not_stated = the file does not say. Null for rows imported before this was kept (treated as not stated).';
comment on column public.expenses.vat_amount is 'VAT stated for this expense. Null when none was stated: shown as "VAT not stated" (DPD charges with none stated show no VAT).';

create or replace function public.ingest_fuel(p_file_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_file public.imported_files;
  r jsonb;
  v_id uuid;
  v_inserted integer := 0;
  v_unchanged integer := 0;
begin
  select * into v_file from public.imported_files where id = p_file_id;
  if not found then
    raise exception 'Imported file % not found', p_file_id;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_id := null;
    insert into public.fuel_transactions
      (account_id, franchise_id, transaction_date, transaction_time, description, supplier, vehicle_registration,
       source_driver_name, card_reference, litres, price_per_litre, total_cost, vat_amount, vat_basis, transaction_ref, source,
       imported_file_id, dedupe_key)
    values
      (v_file.account_id, nullif(r ->> 'franchise_id', '')::uuid, (r ->> 'transaction_date')::date,
       nullif(r ->> 'transaction_time', '')::time, nullif(r ->> 'description', ''), nullif(r ->> 'supplier', ''),
       nullif(r ->> 'vehicle_registration', ''), nullif(r ->> 'source_driver_name', ''), nullif(r ->> 'card_reference', ''),
       nullif(r ->> 'litres', '')::numeric, nullif(r ->> 'price_per_litre', '')::numeric, (r ->> 'total_cost')::numeric,
       nullif(r ->> 'vat_amount', '')::numeric, nullif(r ->> 'vat_basis', ''), nullif(r ->> 'transaction_ref', ''), v_file.source, v_file.id, r ->> 'dedupe_key')
    on conflict (account_id, dedupe_key) do nothing
    returning id into v_id;

    if v_id is null then
      v_unchanged := v_unchanged + 1;
    else
      v_inserted := v_inserted + 1;
      if nullif(r ->> 'driver_id', '') is not null then
        insert into public.expense_allocations (account_id, fuel_transaction_id, scope, driver_id, method, note)
        values (v_file.account_id, v_id, 'driver', (r ->> 'driver_id')::uuid, r ->> 'allocation_method', nullif(r ->> 'allocation_note', ''));
      end if;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'unchanged', v_unchanged, 'conflicts', 0);
end $$;

revoke execute on function public.ingest_fuel(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_fuel(uuid, jsonb) to service_role;
grant all on public.sync_dispatches, public.alert_log, public.driver_statements to service_role;
