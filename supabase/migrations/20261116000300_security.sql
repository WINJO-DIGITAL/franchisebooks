-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security
--
-- Model
--   • A signed-in user belongs to exactly one account (user_profiles).
--   • Roles: owner (everything), manager (day-to-day changes), viewer (read only).
--   • A user with all_franchises = false only sees franchises granted to them
--     in user_franchise_access, and data belonging to those franchises.
--   • The anonymous role has no access to anything.
--   • The service role (server-side only) bypasses RLS and is used solely by
--     the import pipeline, scheduled jobs and the background worker.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helper functions (SECURITY DEFINER so policies can read user_profiles) ──
create or replace function app_private.current_account_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select account_id from public.user_profiles where id = (select auth.uid())
$$;

create or replace function app_private.current_user_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.user_profiles where id = (select auth.uid())
$$;

create or replace function app_private.can_write() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('owner', 'manager') from public.user_profiles where id = (select auth.uid())), false)
$$;

create or replace function app_private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'owner' from public.user_profiles where id = (select auth.uid())), false)
$$;

create or replace function app_private.has_all_franchises() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select all_franchises from public.user_profiles where id = (select auth.uid())), false)
$$;

-- True when the signed-in user may see the given franchise (null = account-level row).
create or replace function app_private.can_access_franchise(p_franchise_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when p_franchise_id is null then
      coalesce((select all_franchises from public.user_profiles where id = (select auth.uid())), false)
    else exists (
      select 1
      from public.user_profiles p
      join public.franchises f on f.account_id = p.account_id
      where p.id = (select auth.uid())
        and f.id = p_franchise_id
        and (p.all_franchises or exists (
          select 1 from public.user_franchise_access a where a.user_id = p.id and a.franchise_id = f.id
        ))
    )
  end
$$;

-- True when the signed-in user may see the given driver.
create or replace function app_private.can_access_driver(p_driver_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_profiles p
    join public.drivers d on d.account_id = p.account_id
    where p.id = (select auth.uid())
      and d.id = p_driver_id
      and (p.all_franchises or exists (
        select 1
        from public.driver_assignments da
        join public.user_franchise_access a on a.franchise_id = da.franchise_id and a.user_id = p.id
        where da.driver_id = d.id
      ))
  )
$$;

revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;
revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated, service_role;
revoke all on all tables in schema app_private from public, anon, authenticated;
grant all on all tables in schema app_private to service_role;

-- ── Table privileges: explicit, least-privilege ─────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant select on
  public.accounts, public.user_profiles, public.user_franchise_access, public.franchises, public.app_settings,
  public.drivers, public.driver_aliases, public.driver_assignments,
  public.import_jobs, public.imported_files, public.sync_logs,
  public.integration_connections, public.integration_folders,
  public.daily_earnings, public.driver_cover_records, public.earnings_adjustments, public.revenue_entries,
  public.expense_categories, public.fuel_transactions, public.expenses, public.expense_allocations,
  public.review_items, public.anomalies, public.monthly_reports, public.audit_logs
to authenticated;

-- Direct writes allowed from a signed-in session (still filtered by the policies below).
grant insert, update on public.franchises, public.drivers, public.driver_assignments, public.expense_categories to authenticated;
grant insert, delete on public.driver_aliases to authenticated;
grant delete on public.driver_assignments to authenticated;
grant update (name) on public.accounts to authenticated;
grant update (full_name) on public.user_profiles to authenticated;
grant insert, update on public.app_settings to authenticated;
grant insert on public.earnings_adjustments to authenticated;
grant insert on public.revenue_entries to authenticated;
grant update (is_void, void_reason, voided_by, voided_at, description, status) on public.revenue_entries to authenticated;
grant insert on public.fuel_transactions, public.expenses to authenticated;
grant update (is_void, void_reason, voided_by, voided_at, franchise_id, description, supplier, vehicle_registration) on public.fuel_transactions to authenticated;
grant update (is_void, void_reason, voided_by, voided_at, franchise_id, description, supplier, vehicle_registration, category_id) on public.expenses to authenticated;
grant update (status, status_note, status_changed_by, status_changed_at) on public.anomalies to authenticated;
grant update (driver_id) on public.daily_earnings to authenticated;
grant insert, update (default_franchise_id), delete on public.integration_folders to authenticated;

-- ── Enable RLS everywhere ───────────────────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;
alter table app_private.integration_secrets enable row level security;

-- ── Policies ────────────────────────────────────────────────────────────────
-- accounts / profiles
create policy accounts_read on public.accounts for select to authenticated
  using (id = (select app_private.current_account_id()));
create policy accounts_update on public.accounts for update to authenticated
  using (id = (select app_private.current_account_id()) and (select app_private.is_owner()))
  with check (id = (select app_private.current_account_id()));

create policy profiles_read on public.user_profiles for select to authenticated
  using (account_id = (select app_private.current_account_id()));
create policy profiles_update_self on public.user_profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy franchise_access_read on public.user_franchise_access for select to authenticated
  using (user_id = (select auth.uid()) or ((select app_private.is_owner()) and app_private.can_access_franchise(franchise_id)));

-- franchises
create policy franchises_read on public.franchises for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(id));
create policy franchises_insert on public.franchises for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.is_owner()));
create policy franchises_update on public.franchises for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.is_owner()))
  with check (account_id = (select app_private.current_account_id()));

-- settings
create policy settings_read on public.app_settings for select to authenticated
  using (account_id = (select app_private.current_account_id()));
create policy settings_insert on public.app_settings for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.is_owner()));
create policy settings_update on public.app_settings for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.is_owner()))
  with check (account_id = (select app_private.current_account_id()));

-- drivers
create policy drivers_read on public.drivers for select to authenticated
  using (account_id = (select app_private.current_account_id())
         and ((select app_private.has_all_franchises()) or app_private.can_access_driver(id)));
create policy drivers_insert on public.drivers for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));
create policy drivers_update on public.drivers for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write())
         and ((select app_private.has_all_franchises()) or app_private.can_access_driver(id)))
  with check (account_id = (select app_private.current_account_id()));

create policy driver_aliases_read on public.driver_aliases for select to authenticated
  using (account_id = (select app_private.current_account_id())
         and ((select app_private.has_all_franchises()) or app_private.can_access_driver(driver_id)));
create policy driver_aliases_insert on public.driver_aliases for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));
create policy driver_aliases_delete on public.driver_aliases for delete to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));

create policy driver_assignments_read on public.driver_assignments for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy driver_assignments_insert on public.driver_assignments for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.can_write())
              and app_private.can_access_franchise(franchise_id));
create policy driver_assignments_update on public.driver_assignments for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write())
         and app_private.can_access_franchise(franchise_id))
  with check (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy driver_assignments_delete on public.driver_assignments for delete to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write())
         and app_private.can_access_franchise(franchise_id));

-- Franchise-scoped read-only tables (written by the server-side import pipeline).
create policy import_jobs_read on public.import_jobs for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy imported_files_read on public.imported_files for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy sync_logs_read on public.sync_logs for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy review_items_read on public.review_items for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy monthly_reports_read on public.monthly_reports for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));

create policy integration_connections_read on public.integration_connections for select to authenticated
  using (account_id = (select app_private.current_account_id()));
create policy integration_folders_read on public.integration_folders for select to authenticated
  using (account_id = (select app_private.current_account_id()));
create policy integration_folders_insert on public.integration_folders for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.is_owner()));
create policy integration_folders_update on public.integration_folders for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.is_owner()))
  with check (account_id = (select app_private.current_account_id()));
create policy integration_folders_delete on public.integration_folders for delete to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.is_owner()));

-- earnings (imported figures: read, plus linking a row to a driver)
create policy daily_earnings_read on public.daily_earnings for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy daily_earnings_link_driver on public.daily_earnings for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write())
         and app_private.can_access_franchise(franchise_id))
  with check (account_id = (select app_private.current_account_id()));

-- pay adjustments: insert-only ledger
create policy adjustments_read on public.earnings_adjustments for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy adjustments_insert on public.earnings_adjustments for insert to authenticated
  with check (account_id = (select app_private.current_account_id())
              and (select app_private.can_write())
              and app_private.can_access_franchise(franchise_id)
              and created_by = (select auth.uid()));

create policy cover_read on public.driver_cover_records for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));

-- revenue
create policy revenue_read on public.revenue_entries for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy revenue_insert on public.revenue_entries for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.is_owner())
              and created_by = (select auth.uid()));
create policy revenue_update on public.revenue_entries for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.is_owner()))
  with check (account_id = (select app_private.current_account_id()));

-- expense categories
create policy categories_read on public.expense_categories for select to authenticated
  using (account_id = (select app_private.current_account_id()));
create policy categories_insert on public.expense_categories for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.can_write()) and not is_system);
create policy categories_update on public.expense_categories for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write()))
  with check (account_id = (select app_private.current_account_id()));

-- fuel and expenses
create policy fuel_read on public.fuel_transactions for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy fuel_insert on public.fuel_transactions for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.can_write())
              and app_private.can_access_franchise(franchise_id)
              and source = 'manual_entry' and created_by = (select auth.uid()));
create policy fuel_update on public.fuel_transactions for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write())
         and app_private.can_access_franchise(franchise_id))
  with check (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));

create policy expenses_read on public.expenses for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.can_write())
              and app_private.can_access_franchise(franchise_id)
              and source = 'manual_entry' and created_by = (select auth.uid()));
create policy expenses_update on public.expenses for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write())
         and app_private.can_access_franchise(franchise_id))
  with check (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));

create policy allocations_read on public.expense_allocations for select to authenticated
  using (account_id = (select app_private.current_account_id()));

-- anomalies: read, and update the review status only
create policy anomalies_read on public.anomalies for select to authenticated
  using (account_id = (select app_private.current_account_id()) and app_private.can_access_franchise(franchise_id));
create policy anomalies_update on public.anomalies for update to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write())
         and app_private.can_access_franchise(franchise_id))
  with check (account_id = (select app_private.current_account_id()));

-- audit log: owners and managers
create policy audit_read on public.audit_logs for select to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));
