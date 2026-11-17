-- Day rates: what a driver is paid for each day they work.
-- Append-only: a change of rate is a new row with a new effective date, so past
-- wages never move. There is deliberately no update or delete policy.

create table public.driver_day_rates (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete restrict,
  driver_id       uuid not null,
  day_rate        numeric(10,2) not null check (day_rate >= 0 and day_rate <= 1000),
  effective_from  date not null,
  note            text check (note is null or length(note) <= 500),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (driver_id, account_id) references public.drivers (id, account_id) on delete restrict,
  unique (driver_id, effective_from)
);
comment on table public.driver_day_rates is 'Day rate paid to a driver from a given date. Append-only: a new rate is a new row.';

create index driver_day_rates_driver_idx on public.driver_day_rates (account_id, driver_id, effective_from desc);

alter table public.driver_day_rates enable row level security;

create policy driver_day_rates_read on public.driver_day_rates for select to authenticated
  using (account_id = (select app_private.current_account_id())
         and ((select app_private.has_all_franchises()) or app_private.can_access_driver(driver_id)));

create policy driver_day_rates_insert on public.driver_day_rates for insert to authenticated
  with check (account_id = (select app_private.current_account_id())
              and (select app_private.can_write())
              and ((select app_private.has_all_franchises()) or app_private.can_access_driver(driver_id)));

revoke update, delete, truncate on public.driver_day_rates from anon, authenticated;
