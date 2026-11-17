-- Tables added after the first security migration (driver_day_rates, dpd_invoices) had row level security enabled but
-- not forced, and were not closed to anonymous visitors the way the older tables are. Bring them in line, and repeat the
-- sweep so any table created since is covered. Safe to run again.

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

revoke all on public.driver_day_rates, public.dpd_invoices from anon;
