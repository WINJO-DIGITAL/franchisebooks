-- The end-of-period reports share the monthly_reports table with the Period Report.
-- "kind" says which report a row is. Existing rows are Period Reports.
alter table public.monthly_reports
  add column if not exists kind text not null default 'period'
  check (kind in ('period', 'driver_pay', 'profit_loss', 'discrepancy'));

comment on column public.monthly_reports.kind is 'period = the Period Report; driver_pay = Driver Pay Report; profit_loss = Profit and Loss; discrepancy = Sliding Scale Discrepancy (Max).';
