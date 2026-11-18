-- Pay basis for driver rates: a driver can be paid per day worked ("day", the original behaviour)
-- or per stop ("stop"). Existing rows are all per day. Append-only table: no update or delete policy is added.

alter table public.driver_day_rates
  add column pay_basis text not null default 'day' check (pay_basis in ('day', 'stop'));

comment on column public.driver_day_rates.pay_basis is 'How day_rate is paid: "day" per day worked, or "stop" per stop worked.';
