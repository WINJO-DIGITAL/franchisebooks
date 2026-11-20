-- Pay rules on a driver's day rate, set by the owner for that driver:
--  * extra pay per stop: each stop over bonus_after_stops in a day pays bonus_per_stop extra;
--  * a days-in-a-row rate: from the day after streak_after_days days in a row, the day pays streak_day_rate instead.
-- Both are optional and apply to day rates only. The table is append-only, so a change is a new row with a new date.

alter table public.driver_day_rates
  add column bonus_after_stops integer check (bonus_after_stops is null or (bonus_after_stops >= 0 and bonus_after_stops <= 1000)),
  add column bonus_per_stop numeric(10,2) check (bonus_per_stop is null or (bonus_per_stop >= 0 and bonus_per_stop <= 100)),
  add column streak_after_days integer check (streak_after_days is null or (streak_after_days >= 1 and streak_after_days <= 30)),
  add column streak_day_rate numeric(10,2) check (streak_day_rate is null or (streak_day_rate >= 0 and streak_day_rate <= 1000));

alter table public.driver_day_rates
  add constraint driver_day_rates_extra_pair check ((bonus_after_stops is null) = (bonus_per_stop is null)),
  add constraint driver_day_rates_streak_pair check ((streak_after_days is null) = (streak_day_rate is null)),
  add constraint driver_day_rates_rules_day_only check (pay_basis = 'day' or (bonus_after_stops is null and streak_after_days is null));

comment on column public.driver_day_rates.bonus_after_stops is 'Day rates: stops in a day after which each further stop pays bonus_per_stop.';
comment on column public.driver_day_rates.bonus_per_stop is 'Day rates: pounds paid for each stop over bonus_after_stops.';
comment on column public.driver_day_rates.streak_after_days is 'Day rates: after this many days in a row, the day pays streak_day_rate.';
comment on column public.driver_day_rates.streak_day_rate is 'Day rates: pounds per day once the driver is past streak_after_days days in a row.';
