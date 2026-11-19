-- A DPD credit note corrects earlier mistakes in what DPD paid a driver, so it is linked to that driver as well as to
-- the franchise and the period it covers (period_start and period_end already hold that). Optional: other revenue has no driver.

alter table public.revenue_entries add column if not exists driver_id uuid;
alter table public.revenue_entries drop constraint if exists revenue_entries_driver_id_account_id_fkey;
alter table public.revenue_entries add constraint revenue_entries_driver_id_account_id_fkey
  foreign key (driver_id, account_id) references public.drivers (id, account_id) on delete restrict;
create index if not exists revenue_entries_driver_idx on public.revenue_entries (account_id, driver_id) where driver_id is not null;
comment on column public.revenue_entries.driver_id is 'The driver a DPD credit note corrects. Null for other revenue.';
