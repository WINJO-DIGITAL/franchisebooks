-- What the imported DPD earnings mean for this business.
--   driver_pay    : they are what drivers are paid (a cost). The original behaviour.
--   route_income  : they are what DPD pays the franchise for each route and day (income);
--                   driver wages come from day rates (driver_day_rates).
alter table public.app_settings
  add column earnings_meaning text not null default 'driver_pay'
  check (earnings_meaning in ('driver_pay', 'route_income'));

comment on column public.app_settings.earnings_meaning is 'Whether imported DPD earnings are driver pay (cost) or route income (revenue).';
