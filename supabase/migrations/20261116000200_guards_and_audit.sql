-- ════════════════════════════════════════════════════════════════════════════
-- Integrity guards and audit logging
-- These triggers apply to every role, including the service role, so the
-- guarantees hold no matter which part of the system writes.
-- ════════════════════════════════════════════════════════════════════════════

-- ── updated_at maintenance ──────────────────────────────────────────────────
create or replace function app_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger touch_updated_at before update on public.user_profiles for each row execute function app_private.touch_updated_at();
create trigger touch_updated_at before update on public.franchises for each row execute function app_private.touch_updated_at();
create trigger touch_updated_at before update on public.drivers for each row execute function app_private.touch_updated_at();
create trigger touch_updated_at before update on public.driver_assignments for each row execute function app_private.touch_updated_at();
create trigger touch_updated_at before update on public.integration_connections for each row execute function app_private.touch_updated_at();
create trigger touch_updated_at before update on public.app_settings for each row execute function app_private.touch_updated_at();

-- ── Append-only tables ──────────────────────────────────────────────────────
create or replace function app_private.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: rows cannot be changed or deleted. Add a correcting entry instead.', tg_table_name
    using errcode = 'P0001';
end $$;

create trigger earnings_adjustments_append_only
  before update or delete on public.earnings_adjustments
  for each row execute function app_private.forbid_change();

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function app_private.forbid_change();

-- ── Imported DPD figures are read-only ──────────────────────────────────────
-- Only two things may ever change on an imported earnings row:
--   • linking it to a registered driver (driver_id), and
--   • marking it as replaced by a later owner-approved import.
create or replace function app_private.guard_daily_earnings() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Imported DPD figures cannot be deleted.' using errcode = 'P0001';
  end if;
  if (new.account_id, new.franchise_id, new.source_driver_name, new.source_driver_ref, new.driver_key,
      new.report_date, new.route, new.parcels, new.stops, new.pay_per_parcel, new.pay_per_stop,
      new.gross_earnings, new.deductions, new.additional_payments, new.net_earnings,
      new.imported_file_id, new.source, new.extracted_at, new.created_at)
     is distinct from
     (old.account_id, old.franchise_id, old.source_driver_name, old.source_driver_ref, old.driver_key,
      old.report_date, old.route, old.parcels, old.stops, old.pay_per_parcel, old.pay_per_stop,
      old.gross_earnings, old.deductions, old.additional_payments, old.net_earnings,
      old.imported_file_id, old.source, old.extracted_at, old.created_at)
  then
    raise exception 'Imported DPD figures are read-only. Use a pay adjustment, or resolve the import conflict, instead.'
      using errcode = 'P0001';
  end if;
  if old.is_current = false and new.is_current = true then
    raise exception 'A replaced earnings row cannot be made current again.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger daily_earnings_guard
  before update or delete on public.daily_earnings
  for each row execute function app_private.guard_daily_earnings();

-- ── Money rows are voided, never deleted ────────────────────────────────────
create or replace function app_private.forbid_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% rows cannot be deleted. Mark the row as void instead.', tg_table_name using errcode = 'P0001';
end $$;

create trigger fuel_transactions_no_delete before delete on public.fuel_transactions for each row execute function app_private.forbid_delete();
create trigger expenses_no_delete before delete on public.expenses for each row execute function app_private.forbid_delete();
create trigger revenue_entries_no_delete before delete on public.revenue_entries for each row execute function app_private.forbid_delete();
create trigger expense_allocations_no_delete before delete on public.expense_allocations for each row execute function app_private.forbid_delete();
create trigger driver_cover_records_no_delete before delete on public.driver_cover_records for each row execute function app_private.forbid_delete();
create trigger imported_files_no_delete before delete on public.imported_files for each row execute function app_private.forbid_delete();

-- Amounts on imported or recorded costs are fixed once stored; only voiding is allowed.
create or replace function app_private.guard_cost_amounts() returns trigger
language plpgsql set search_path = '' as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  k text;
begin
  foreach k in array array['account_id', 'amount', 'total_cost', 'litres', 'price_per_litre', 'transaction_date',
                           'expense_date', 'period_start', 'period_end', 'dedupe_key', 'imported_file_id', 'source']
  loop
    if (o -> k) is distinct from (n -> k) then
      raise exception 'The % of a stored % cannot be changed. Void it and record a new one instead.', k, tg_table_name
        using errcode = 'P0001';
    end if;
  end loop;
  if old.is_void and not new.is_void then
    raise exception 'A voided % cannot be restored. Record a new one instead.', tg_table_name using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger fuel_transactions_guard before update on public.fuel_transactions for each row execute function app_private.guard_cost_amounts();
create trigger expenses_guard before update on public.expenses for each row execute function app_private.guard_cost_amounts();
create trigger revenue_entries_guard before update on public.revenue_entries for each row execute function app_private.guard_cost_amounts();

-- ── Audit log ───────────────────────────────────────────────────────────────
-- Generic row-level audit trigger. Records the actor (the signed-in user, or
-- the user recorded on the row when the server acts on their behalf), the
-- action and the before/after images.
create or replace function app_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_actor uuid := auth.uid();
  v_account uuid;
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return null;
  end if;

  v_account := case when tg_table_name = 'accounts' then (v_row ->> 'id')::uuid else (v_row ->> 'account_id')::uuid end;
  if v_account is null then
    return null;
  end if;

  if v_actor is null then
    v_actor := coalesce(
      nullif(v_row ->> 'updated_by', '')::uuid,
      nullif(v_row ->> 'status_changed_by', '')::uuid,
      nullif(v_row ->> 'resolved_by', '')::uuid,
      nullif(v_row ->> 'cancelled_by', '')::uuid,
      nullif(v_row ->> 'voided_by', '')::uuid,
      case when tg_op = 'INSERT' then coalesce(nullif(v_row ->> 'created_by', '')::uuid, nullif(v_row ->> 'uploaded_by', '')::uuid) end
    );
  end if;

  insert into public.audit_logs (account_id, actor_id, actor_type, action, entity_table, entity_id, before, after)
  values (
    v_account,
    v_actor,
    case when v_actor is null then 'system' else 'user' end,
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'account_id'),
    v_old - 'cursor',
    v_new - 'cursor'
  );
  return null;
end $$;

-- Every change to these tables is audited.
create trigger audit after insert or update or delete on public.earnings_adjustments for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.driver_cover_records for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.drivers for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.driver_assignments for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.franchises for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.expense_allocations for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.expense_categories for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.revenue_entries for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.integration_connections for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.integration_folders for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.app_settings for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.user_profiles for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.user_franchise_access for each row execute function app_private.audit_row();

-- Bulk-imported rows are traceable through imported_files; only human actions on them are audited.
create trigger audit after update on public.daily_earnings for each row execute function app_private.audit_row();
create trigger audit after update on public.fuel_transactions for each row execute function app_private.audit_row();
create trigger audit after update on public.expenses for each row execute function app_private.audit_row();
create trigger audit_manual after insert on public.fuel_transactions for each row when (new.source = 'manual_entry') execute function app_private.audit_row();
create trigger audit_manual after insert on public.expenses for each row when (new.source = 'manual_entry') execute function app_private.audit_row();
create trigger audit_manual after insert on public.imported_files for each row when (new.source = 'manual_upload') execute function app_private.audit_row();
create trigger audit after update on public.review_items for each row when (old.status is distinct from new.status) execute function app_private.audit_row();
create trigger audit after update on public.anomalies for each row when (old.status is distinct from new.status and not new.auto_resolved) execute function app_private.audit_row();
