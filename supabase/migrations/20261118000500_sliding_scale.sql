-- DPD's sliding scale: the rate paid per stop by vehicle (type, size, diesel or electric) and by the stops and miles
-- of the day. The owner copies the bands from the portal's Sliding Scale page. Rows can be removed and re-entered
-- to correct a mistake; each change is audited like the other business tables.

create table public.sliding_scale_rates (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  vehicle_type  text not null check (length(btrim(vehicle_type)) between 1 and 80),
  vehicle_size  text check (vehicle_size is null or length(vehicle_size) <= 80),
  fuel_type     text not null default 'diesel' check (fuel_type in ('diesel', 'electric', 'other')),
  stops_from    integer not null check (stops_from >= 0),
  stops_to      integer check (stops_to is null or stops_to >= stops_from),
  miles_from    integer check (miles_from is null or miles_from >= 0),
  miles_to      integer check (miles_to is null or miles_to >= coalesce(miles_from, 0)),
  rate          numeric(10,4) not null check (rate >= 0 and rate <= 100),
  note          text check (note is null or length(note) <= 500),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
comment on table public.sliding_scale_rates is 'Pay per stop by vehicle and by the stops and miles of the day, copied from the DPD portal Sliding Scale page.';

create index sliding_scale_rates_lookup_idx on public.sliding_scale_rates (account_id, vehicle_type, vehicle_size, fuel_type, stops_from);

alter table public.sliding_scale_rates enable row level security;
alter table public.sliding_scale_rates force row level security;

create policy sliding_scale_rates_read on public.sliding_scale_rates for select to authenticated
  using (account_id = (select app_private.current_account_id()));

create policy sliding_scale_rates_insert on public.sliding_scale_rates for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));

create policy sliding_scale_rates_delete on public.sliding_scale_rates for delete to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));

revoke all on public.sliding_scale_rates from anon;
revoke update, truncate on public.sliding_scale_rates from authenticated;

create trigger audit after insert or update or delete on public.sliding_scale_rates for each row execute function app_private.audit_row();
