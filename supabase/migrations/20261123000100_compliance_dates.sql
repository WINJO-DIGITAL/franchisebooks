-- Expiry dates for drivers (licence, right to work, DBS) and vehicles (MOT, service, road tax, insurance), so an owner is
-- reminded before one lapses. A reminder only: nothing here changes pay or any figure from DPD.
create table public.compliance_dates (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references public.accounts (id) on delete cascade,
  subject_type          text not null check (subject_type in ('driver', 'vehicle')),
  driver_id             uuid references public.drivers (id) on delete cascade,
  vehicle_registration  text check (vehicle_registration is null or vehicle_registration = upper(replace(vehicle_registration, ' ', ''))),
  kind                  text not null check (kind in ('driver_licence', 'right_to_work', 'dbs', 'driver_other', 'mot', 'service', 'road_tax', 'vehicle_insurance', 'vehicle_other')),
  label                 text check (label is null or length(btrim(label)) between 1 and 120),
  expires_on            date not null,
  notes                 text check (notes is null or length(notes) <= 1000),
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (
    (subject_type = 'driver' and driver_id is not null and vehicle_registration is null
       and kind in ('driver_licence', 'right_to_work', 'dbs', 'driver_other'))
    or
    (subject_type = 'vehicle' and vehicle_registration is not null and driver_id is null
       and kind in ('mot', 'service', 'road_tax', 'vehicle_insurance', 'vehicle_other'))
  )
);
comment on table public.compliance_dates is 'Expiry dates for drivers and vehicles, for reminders only. Changes no pay or DPD figure.';
create index compliance_dates_account_expiry_idx on public.compliance_dates (account_id, expires_on);

alter table public.compliance_dates enable row level security;
alter table public.compliance_dates force row level security;
grant select, insert, update, delete on public.compliance_dates to authenticated;

create policy compliance_dates_read on public.compliance_dates for select to authenticated
  using (account_id = (select app_private.current_account_id()));
create policy compliance_dates_insert on public.compliance_dates for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));
create policy compliance_dates_update on public.compliance_dates for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write()))
  with check (account_id = (select app_private.current_account_id()));
create policy compliance_dates_delete on public.compliance_dates for delete to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));
