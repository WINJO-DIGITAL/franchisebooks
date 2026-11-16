-- ════════════════════════════════════════════════════════════════════════════
-- Server-side operations
-- Multi-row financial changes run inside a single database function so they
-- are atomic: either every row is written or none is.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Account bootstrap (first sign-in) ───────────────────────────────────────
create or replace function public.bootstrap_account(p_business_name text, p_full_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_account uuid;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  if exists (select 1 from public.user_profiles where id = v_user) then
    raise exception 'This user already belongs to a business.' using errcode = 'P0001';
  end if;

  insert into public.accounts (name) values (btrim(p_business_name)) returning id into v_account;
  insert into public.user_profiles (id, account_id, full_name, role, all_franchises)
    values (v_user, v_account, coalesce(btrim(p_full_name), ''), 'owner', true);
  insert into public.app_settings (account_id, updated_by) values (v_account, v_user);
  insert into public.expense_categories (account_id, name, kind, is_system, sort_order) values
    (v_account, 'Fuel', 'fuel', true, 10),
    (v_account, 'Vehicle maintenance', 'vehicle', true, 20),
    (v_account, 'Repairs', 'vehicle', true, 30),
    (v_account, 'Tyres', 'vehicle', true, 40),
    (v_account, 'Insurance', 'vehicle', true, 50),
    (v_account, 'Vehicle hire', 'vehicle', true, 60),
    (v_account, 'Parking', 'other', true, 70),
    (v_account, 'Equipment', 'other', true, 80),
    (v_account, 'Other operating expenses', 'other', true, 90);
  return v_account;
end $$;

-- ── Pay adjustments ─────────────────────────────────────────────────────────
-- p_amount is the signed effect on the driver's pay (negative deducts).
create or replace function public.create_pay_adjustment(
  p_franchise_id uuid, p_driver_id uuid, p_earnings_date date,
  p_type text, p_amount numeric, p_reason text
) returns public.earnings_adjustments
language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.earnings_adjustments;
begin
  if p_type = 'cover_payment' and p_amount < 0 then
    raise exception 'A cover payment cannot be negative.' using errcode = 'P0001';
  end if;
  insert into public.earnings_adjustments
    (account_id, franchise_id, driver_id, earnings_date, adjustment_type, amount, reason, created_by)
  values
    ((select app_private.current_account_id()), p_franchise_id, p_driver_id, p_earnings_date,
     p_type, round(p_amount, 2), btrim(p_reason), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- Reverses an adjustment by adding an equal and opposite entry. Nothing is deleted.
create or replace function public.reverse_pay_adjustment(p_adjustment_id uuid, p_reason text)
returns public.earnings_adjustments
language plpgsql security invoker set search_path = '' as $$
declare
  v_orig public.earnings_adjustments;
  v_row public.earnings_adjustments;
begin
  select * into v_orig from public.earnings_adjustments where id = p_adjustment_id;
  if not found then
    raise exception 'Adjustment not found.' using errcode = 'P0002';
  end if;
  if v_orig.reverses_adjustment_id is not null then
    raise exception 'This entry is itself a reversal and cannot be reversed. Add a new adjustment instead.' using errcode = 'P0001';
  end if;
  if v_orig.cover_record_id is not null then
    raise exception 'This adjustment belongs to a driver cover record. Cancel the cover record to reverse it.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.earnings_adjustments where reverses_adjustment_id = v_orig.id) then
    raise exception 'This adjustment has already been reversed.' using errcode = 'P0001';
  end if;

  insert into public.earnings_adjustments
    (account_id, franchise_id, driver_id, earnings_date, adjustment_type, amount, reason, reverses_adjustment_id, created_by)
  values
    (v_orig.account_id, v_orig.franchise_id, v_orig.driver_id, v_orig.earnings_date, v_orig.adjustment_type,
     -v_orig.amount, btrim(p_reason), v_orig.id, auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- ── Driver cover ────────────────────────────────────────────────────────────
create or replace function public.record_driver_cover(
  p_franchise_id uuid, p_cover_date date, p_original_driver_id uuid, p_covering_driver_id uuid,
  p_route text, p_notes text, p_earnings_allocation text,
  p_amount_to_covering numeric, p_amount_from_original numeric, p_expense_attribution text
) returns public.driver_cover_records
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_account uuid := app_private.current_account_id();
  v_to numeric(12,2) := round(coalesce(p_amount_to_covering, 0), 2);
  v_from numeric(12,2) := round(coalesce(p_amount_from_original, 0), 2);
  v_original_name text;
  v_covering_name text;
  v_day_total numeric(12,2);
  v_cover public.driver_cover_records;
  v_label text;
begin
  if v_user is null or v_account is null or not app_private.can_write() or not app_private.can_access_franchise(p_franchise_id) then
    raise exception 'You do not have permission to record driver cover for this franchise.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.franchises where id = p_franchise_id and account_id = v_account) then
    raise exception 'Franchise not found.' using errcode = 'P0002';
  end if;
  select display_name into v_original_name from public.drivers where id = p_original_driver_id and account_id = v_account;
  select display_name into v_covering_name from public.drivers where id = p_covering_driver_id and account_id = v_account;
  if v_original_name is null or v_covering_name is null then
    raise exception 'Driver not found.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.driver_cover_records
    where franchise_id = p_franchise_id and cover_date = p_cover_date and status = 'active'
      and original_driver_id = p_original_driver_id and covering_driver_id = p_covering_driver_id
      and coalesce(route, '') = coalesce(nullif(btrim(p_route), ''), '')
  ) then
    raise exception 'This cover has already been recorded for that day.' using errcode = 'P0001';
  end if;

  if p_earnings_allocation = 'none' then
    v_to := 0; v_from := 0;
  elsif p_earnings_allocation = 'all_to_cover' then
    select sum(original_earnings) into v_day_total
    from public.daily_earnings
    where franchise_id = p_franchise_id and driver_id = p_original_driver_id
      and report_date = p_cover_date and is_current;
    if v_day_total is null then
      raise exception 'There are no imported DPD earnings for % on that date yet, so the full amount cannot be moved. Enter the amounts yourself instead.', v_original_name
        using errcode = 'P0001';
    end if;
    v_to := v_day_total; v_from := v_day_total;
  elsif p_earnings_allocation <> 'custom' then
    raise exception 'Unknown allocation option.' using errcode = 'P0001';
  end if;
  if v_to < 0 or v_from < 0 then
    raise exception 'Amounts cannot be negative.' using errcode = 'P0001';
  end if;

  insert into public.driver_cover_records
    (account_id, franchise_id, cover_date, original_driver_id, covering_driver_id, route, notes,
     earnings_allocation, amount_to_covering, amount_from_original, expense_attribution, created_by)
  values
    (v_account, p_franchise_id, p_cover_date, p_original_driver_id, p_covering_driver_id,
     nullif(btrim(p_route), ''), nullif(btrim(p_notes), ''),
     p_earnings_allocation, v_to, v_from, p_expense_attribution, v_user)
  returning * into v_cover;

  v_label := format('Cover on %s: %s covered %s', to_char(p_cover_date, 'DD/MM/YYYY'), v_covering_name, v_original_name)
             || coalesce(' (' || nullif(btrim(p_route), '') || ')', '');

  if v_to > 0 then
    insert into public.earnings_adjustments
      (account_id, franchise_id, driver_id, earnings_date, adjustment_type, amount, reason, cover_record_id, created_by)
    values (v_account, p_franchise_id, p_covering_driver_id, p_cover_date, 'cover_payment', v_to, v_label, v_cover.id, v_user);
  end if;
  if v_from > 0 then
    insert into public.earnings_adjustments
      (account_id, franchise_id, driver_id, earnings_date, adjustment_type, amount, reason, cover_record_id, created_by)
    values (v_account, p_franchise_id, p_original_driver_id, p_cover_date, 'deduction', -v_from, v_label, v_cover.id, v_user);
  end if;
  return v_cover;
end $$;

create or replace function public.cancel_driver_cover(p_cover_id uuid, p_reason text)
returns public.driver_cover_records
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_account uuid := app_private.current_account_id();
  v_cover public.driver_cover_records;
  v_adj public.earnings_adjustments;
begin
  select * into v_cover from public.driver_cover_records where id = p_cover_id and account_id = v_account for update;
  if not found then
    raise exception 'Cover record not found.' using errcode = 'P0002';
  end if;
  if v_user is null or not app_private.can_write() or not app_private.can_access_franchise(v_cover.franchise_id) then
    raise exception 'You do not have permission to cancel this cover record.' using errcode = '42501';
  end if;
  if v_cover.status = 'cancelled' then
    raise exception 'This cover record is already cancelled.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a reason for cancelling.' using errcode = 'P0001';
  end if;

  for v_adj in
    select a.* from public.earnings_adjustments a
    where a.cover_record_id = v_cover.id and a.reverses_adjustment_id is null
      and not exists (select 1 from public.earnings_adjustments r where r.reverses_adjustment_id = a.id)
  loop
    insert into public.earnings_adjustments
      (account_id, franchise_id, driver_id, earnings_date, adjustment_type, amount, reason,
       cover_record_id, reverses_adjustment_id, created_by)
    values
      (v_adj.account_id, v_adj.franchise_id, v_adj.driver_id, v_adj.earnings_date, v_adj.adjustment_type, -v_adj.amount,
       'Cover cancelled: ' || btrim(p_reason), v_cover.id, v_adj.id, v_user);
  end loop;

  update public.driver_cover_records
    set status = 'cancelled', cancelled_at = now(), cancelled_by = v_user, cancel_reason = btrim(p_reason)
    where id = v_cover.id
    returning * into v_cover;
  return v_cover;
end $$;

-- ── Cost attribution ────────────────────────────────────────────────────────
-- Assigns a fuel transaction or expense to a driver, to the franchise in
-- general, or back to "unallocated". Earlier allocations are kept as history.
create or replace function public.set_cost_allocation(
  p_kind text, p_cost_id uuid, p_scope text, p_driver_id uuid, p_note text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_account uuid := app_private.current_account_id();
  v_franchise uuid;
  v_found boolean;
begin
  if p_kind = 'fuel' then
    select franchise_id, true into v_franchise, v_found from public.fuel_transactions where id = p_cost_id and account_id = v_account;
  elsif p_kind = 'expense' then
    select franchise_id, true into v_franchise, v_found from public.expenses where id = p_cost_id and account_id = v_account;
  else
    raise exception 'Unknown cost type.' using errcode = 'P0001';
  end if;
  if v_found is not true then
    raise exception 'Cost not found.' using errcode = 'P0002';
  end if;
  if v_user is null or not app_private.can_write() or not app_private.can_access_franchise(v_franchise) then
    raise exception 'You do not have permission to assign this cost.' using errcode = '42501';
  end if;
  if p_scope = 'driver' and not exists (select 1 from public.drivers where id = p_driver_id and account_id = v_account) then
    raise exception 'Driver not found.' using errcode = 'P0002';
  end if;
  if p_scope not in ('driver', 'franchise', 'unallocated') then
    raise exception 'Unknown allocation option.' using errcode = 'P0001';
  end if;

  update public.expense_allocations
    set is_current = false, replaced_at = now()
    where is_current and account_id = v_account
      and ((p_kind = 'fuel' and fuel_transaction_id = p_cost_id) or (p_kind = 'expense' and expense_id = p_cost_id));

  if p_scope <> 'unallocated' then
    insert into public.expense_allocations
      (account_id, expense_id, fuel_transaction_id, scope, driver_id, method, note, created_by)
    values
      (v_account,
       case when p_kind = 'expense' then p_cost_id end,
       case when p_kind = 'fuel' then p_cost_id end,
       p_scope, case when p_scope = 'driver' then p_driver_id end, 'manual', nullif(btrim(p_note), ''), v_user);
  end if;
end $$;

-- ── Linking imported rows to a registered driver ────────────────────────────
create or replace function public.link_earnings_to_driver(
  p_franchise_id uuid, p_driver_key text, p_driver_id uuid, p_alias text
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_account uuid := (select app_private.current_account_id());
  v_count integer;
begin
  if not exists (select 1 from public.drivers where id = p_driver_id) then
    raise exception 'Driver not found.' using errcode = 'P0002';
  end if;
  update public.daily_earnings
    set driver_id = p_driver_id
    where franchise_id = p_franchise_id and driver_key = p_driver_key and driver_id is null;
  get diagnostics v_count = row_count;

  if nullif(btrim(p_alias), '') is not null then
    insert into public.driver_aliases (account_id, driver_id, alias_normalised, alias_display)
    values (v_account, p_driver_id, lower(btrim(regexp_replace(p_alias, '\s+', ' ', 'g'))), btrim(p_alias))
    on conflict do nothing;
  end if;
  return v_count;
end $$;

-- ── Import conflicts ────────────────────────────────────────────────────────
-- When a new document disagrees with figures already stored, nothing is
-- overwritten. The owner chooses; if they accept the new figures the old row
-- is kept but marked as replaced.
create or replace function public.resolve_earnings_conflict(p_review_item_id uuid, p_choice text, p_note text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_account uuid := app_private.current_account_id();
  v_item public.review_items;
  v_existing public.daily_earnings;
  v_in jsonb;
  v_new_id uuid;
begin
  select * into v_item from public.review_items
    where id = p_review_item_id and account_id = v_account and kind = 'source_conflict' for update;
  if not found then
    raise exception 'Review item not found.' using errcode = 'P0002';
  end if;
  if v_user is null or not app_private.can_write() or not app_private.can_access_franchise(v_item.franchise_id) then
    raise exception 'You do not have permission to resolve this.' using errcode = '42501';
  end if;
  if v_item.status <> 'open' then
    raise exception 'This item has already been dealt with.' using errcode = 'P0001';
  end if;

  if p_choice = 'use_incoming' then
    select * into v_existing from public.daily_earnings
      where id = (v_item.payload ->> 'existing_id')::uuid and account_id = v_account for update;
    if not found or not v_existing.is_current then
      raise exception 'The stored figures have changed since this conflict was raised. Re-import the document.' using errcode = 'P0001';
    end if;
    v_in := v_item.payload -> 'incoming';
    v_new_id := gen_random_uuid();

    update public.daily_earnings
      set is_current = false, superseded_at = now(),
          superseded_reason = coalesce(nullif(btrim(p_note), ''), 'Replaced by a later document after owner review')
      where id = v_existing.id;

    insert into public.daily_earnings
      (id, account_id, franchise_id, driver_id, source_driver_name, source_driver_ref, driver_key, report_date, route,
       parcels, stops, pay_per_parcel, pay_per_stop, gross_earnings, deductions, additional_payments, net_earnings,
       imported_file_id, source, extraction_confidence)
    values
      (v_new_id, v_account, v_existing.franchise_id, coalesce(v_existing.driver_id, nullif(v_in ->> 'driver_id', '')::uuid),
       v_in ->> 'source_driver_name', nullif(v_in ->> 'source_driver_ref', ''), v_existing.driver_key,
       v_existing.report_date, v_existing.route,
       nullif(v_in ->> 'parcels', '')::integer, nullif(v_in ->> 'stops', '')::integer,
       nullif(v_in ->> 'pay_per_parcel', '')::numeric, nullif(v_in ->> 'pay_per_stop', '')::numeric,
       (v_in ->> 'gross_earnings')::numeric, coalesce(nullif(v_in ->> 'deductions', '')::numeric, 0),
       coalesce(nullif(v_in ->> 'additional_payments', '')::numeric, 0), nullif(v_in ->> 'net_earnings', '')::numeric,
       (v_item.payload ->> 'incoming_file_id')::uuid, v_item.payload ->> 'incoming_source',
       nullif(v_in ->> 'confidence', '')::numeric);

    update public.daily_earnings set superseded_by = v_new_id where id = v_existing.id;
    update public.review_items
      set status = 'accepted', resolved_by = v_user, resolved_at = now(), resolution_note = nullif(btrim(p_note), '')
      where id = v_item.id;
  elsif p_choice = 'keep_existing' then
    update public.review_items
      set status = 'rejected', resolved_by = v_user, resolved_at = now(), resolution_note = nullif(btrim(p_note), '')
      where id = v_item.id;
  else
    raise exception 'Unknown choice.' using errcode = 'P0001';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Service-role-only functions (import pipeline, job queue, secrets)
-- ════════════════════════════════════════════════════════════════════════════

-- Stores parsed earnings rows from one document. Idempotent:
--   • a row that does not exist yet is inserted,
--   • a row identical to what is stored is left alone,
--   • a row that DISAGREES with what is stored is sent for review, not written.
create or replace function public.ingest_earnings(p_file_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_file public.imported_files;
  r jsonb;
  v_existing public.daily_earnings;
  v_inserted integer := 0;
  v_unchanged integer := 0;
  v_conflicts integer := 0;
  v_gross numeric(12,2); v_ded numeric(12,2); v_add numeric(12,2); v_net numeric(12,2);
  v_parcels integer; v_stops integer;
  v_franchise uuid; v_date date; v_route text; v_key text;
begin
  select * into v_file from public.imported_files where id = p_file_id;
  if not found then
    raise exception 'Imported file % not found', p_file_id;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_franchise := (r ->> 'franchise_id')::uuid;
    v_date := (r ->> 'report_date')::date;
    v_route := nullif(r ->> 'route', '');
    v_key := r ->> 'driver_key';
    v_gross := (r ->> 'gross_earnings')::numeric;
    v_ded := coalesce(nullif(r ->> 'deductions', '')::numeric, 0);
    v_add := coalesce(nullif(r ->> 'additional_payments', '')::numeric, 0);
    v_net := nullif(r ->> 'net_earnings', '')::numeric;
    v_parcels := nullif(r ->> 'parcels', '')::integer;
    v_stops := nullif(r ->> 'stops', '')::integer;

    -- Serialise concurrent imports of the same driver-day.
    perform pg_advisory_xact_lock(hashtextextended(v_franchise::text || '|' || v_key || '|' || v_date::text || '|' || coalesce(v_route, ''), 0));

    select * into v_existing from public.daily_earnings
      where franchise_id = v_franchise and driver_key = v_key and report_date = v_date
        and coalesce(route, '') = coalesce(v_route, '') and is_current;

    if not found then
      insert into public.daily_earnings
        (account_id, franchise_id, driver_id, source_driver_name, source_driver_ref, driver_key, report_date, route,
         parcels, stops, pay_per_parcel, pay_per_stop, gross_earnings, deductions, additional_payments, net_earnings,
         imported_file_id, source, extraction_confidence)
      values
        (v_file.account_id, v_franchise, nullif(r ->> 'driver_id', '')::uuid, r ->> 'source_driver_name',
         nullif(r ->> 'source_driver_ref', ''), v_key, v_date, v_route, v_parcels, v_stops,
         nullif(r ->> 'pay_per_parcel', '')::numeric, nullif(r ->> 'pay_per_stop', '')::numeric,
         v_gross, v_ded, v_add, v_net, v_file.id, v_file.source, nullif(r ->> 'confidence', '')::numeric);
      v_inserted := v_inserted + 1;
    elsif (v_existing.gross_earnings, v_existing.deductions, v_existing.additional_payments, v_existing.net_earnings,
           v_existing.parcels, v_existing.stops)
          is not distinct from (v_gross, v_ded, v_add, v_net, v_parcels, v_stops) then
      v_unchanged := v_unchanged + 1;
      if v_existing.driver_id is null and nullif(r ->> 'driver_id', '') is not null then
        update public.daily_earnings set driver_id = (r ->> 'driver_id')::uuid where id = v_existing.id;
      end if;
    else
      insert into public.review_items (account_id, franchise_id, imported_file_id, kind, title, detail, payload, dedupe_key)
      values (
        v_file.account_id, v_franchise, v_file.id, 'source_conflict',
        format('Two documents disagree about %s on %s', r ->> 'source_driver_name', to_char(v_date, 'DD/MM/YYYY')),
        format('The figures already stored say £%s. "%s" says £%s. Nothing has been changed.',
               to_char(v_existing.original_earnings, 'FM999G999G990D00'),
               v_file.original_filename,
               to_char(coalesce(v_net, v_gross - v_ded + v_add), 'FM999G999G990D00')),
        jsonb_build_object(
          'existing_id', v_existing.id,
          'existing', jsonb_build_object(
            'gross_earnings', v_existing.gross_earnings, 'deductions', v_existing.deductions,
            'additional_payments', v_existing.additional_payments, 'net_earnings', v_existing.net_earnings,
            'original_earnings', v_existing.original_earnings,
            'parcels', v_existing.parcels, 'stops', v_existing.stops,
            'imported_file_id', v_existing.imported_file_id, 'source', v_existing.source),
          'incoming', r,
          'incoming_file_id', v_file.id,
          'incoming_source', v_file.source),
        'conflict:' || v_existing.id::text || ':' || md5(concat_ws('|', v_gross, v_ded, v_add, v_net, v_parcels, v_stops))
      )
      on conflict (account_id, dedupe_key) where dedupe_key is not null and status = 'open' do nothing;
      v_conflicts := v_conflicts + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'unchanged', v_unchanged, 'conflicts', v_conflicts);
end $$;

create or replace function public.ingest_fuel(p_file_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_file public.imported_files;
  r jsonb;
  v_id uuid;
  v_inserted integer := 0;
  v_unchanged integer := 0;
begin
  select * into v_file from public.imported_files where id = p_file_id;
  if not found then
    raise exception 'Imported file % not found', p_file_id;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_id := null;
    insert into public.fuel_transactions
      (account_id, franchise_id, transaction_date, transaction_time, description, supplier, vehicle_registration,
       source_driver_name, card_reference, litres, price_per_litre, total_cost, transaction_ref, source,
       imported_file_id, dedupe_key)
    values
      (v_file.account_id, nullif(r ->> 'franchise_id', '')::uuid, (r ->> 'transaction_date')::date,
       nullif(r ->> 'transaction_time', '')::time, nullif(r ->> 'description', ''), nullif(r ->> 'supplier', ''),
       nullif(r ->> 'vehicle_registration', ''), nullif(r ->> 'source_driver_name', ''), nullif(r ->> 'card_reference', ''),
       nullif(r ->> 'litres', '')::numeric, nullif(r ->> 'price_per_litre', '')::numeric, (r ->> 'total_cost')::numeric,
       nullif(r ->> 'transaction_ref', ''), v_file.source, v_file.id, r ->> 'dedupe_key')
    on conflict (account_id, dedupe_key) do nothing
    returning id into v_id;

    if v_id is null then
      v_unchanged := v_unchanged + 1;
    else
      v_inserted := v_inserted + 1;
      if nullif(r ->> 'driver_id', '') is not null then
        insert into public.expense_allocations (account_id, fuel_transaction_id, scope, driver_id, method, note)
        values (v_file.account_id, v_id, 'driver', (r ->> 'driver_id')::uuid, r ->> 'allocation_method', nullif(r ->> 'allocation_note', ''));
      end if;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'unchanged', v_unchanged, 'conflicts', 0);
end $$;

create or replace function public.ingest_expenses(p_file_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_file public.imported_files;
  r jsonb;
  v_id uuid;
  v_inserted integer := 0;
  v_unchanged integer := 0;
begin
  select * into v_file from public.imported_files where id = p_file_id;
  if not found then
    raise exception 'Imported file % not found', p_file_id;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_id := null;
    insert into public.expenses
      (account_id, franchise_id, category_id, expense_date, description, supplier, vehicle_registration,
       source_driver_name, amount, transaction_ref, source, imported_file_id, dedupe_key)
    values
      (v_file.account_id, nullif(r ->> 'franchise_id', '')::uuid, (r ->> 'category_id')::uuid,
       (r ->> 'expense_date')::date, coalesce(r ->> 'description', ''), nullif(r ->> 'supplier', ''),
       nullif(r ->> 'vehicle_registration', ''), nullif(r ->> 'source_driver_name', ''), (r ->> 'amount')::numeric,
       nullif(r ->> 'transaction_ref', ''), v_file.source, v_file.id, r ->> 'dedupe_key')
    on conflict (account_id, dedupe_key) do nothing
    returning id into v_id;

    if v_id is null then
      v_unchanged := v_unchanged + 1;
    else
      v_inserted := v_inserted + 1;
      if nullif(r ->> 'driver_id', '') is not null then
        insert into public.expense_allocations (account_id, expense_id, scope, driver_id, method, note)
        values (v_file.account_id, v_id, 'driver', (r ->> 'driver_id')::uuid, r ->> 'allocation_method', nullif(r ->> 'allocation_note', ''));
      end if;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'unchanged', v_unchanged, 'conflicts', 0);
end $$;

-- ── Job queue ───────────────────────────────────────────────────────────────
-- Queues a job unless an identical one (same type, franchise and report date)
-- is already queued or running. Returns the job that should be watched.
create or replace function public.enqueue_job(
  p_account_id uuid, p_job_type text, p_franchise_id uuid, p_report_date date,
  p_trigger text, p_payload jsonb, p_requested_by uuid
) returns public.import_jobs
language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.import_jobs;
begin
  begin
    insert into public.import_jobs (account_id, job_type, franchise_id, report_date, trigger, payload, requested_by)
    values (p_account_id, p_job_type, p_franchise_id, p_report_date, p_trigger, coalesce(p_payload, '{}'::jsonb), p_requested_by)
    returning * into v_job;
  exception when unique_violation then
    select * into v_job from public.import_jobs
      where account_id = p_account_id and job_type = p_job_type
        and coalesce(franchise_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_franchise_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and coalesce(report_date, '1900-01-01'::date) = coalesce(p_report_date, '1900-01-01'::date)
        and status in ('queued', 'running')
      limit 1;
  end;
  return v_job;
end $$;

-- Atomically claims the next runnable job (safe with several workers).
create or replace function public.claim_next_job(p_worker text, p_types text[])
returns setof public.import_jobs
language sql security invoker set search_path = '' as $$
  update public.import_jobs j
    set status = 'running', locked_at = now(), locked_by = p_worker,
        started_at = coalesce(j.started_at, now()), attempts = j.attempts + 1
  where j.id = (
    select q.id from public.import_jobs q
    where q.status = 'queued' and q.run_after <= now() and q.job_type = any (p_types)
    order by q.run_after, q.created_at
    for update skip locked
    limit 1
  )
  returning j.*;
$$;

-- Returns jobs whose worker died mid-run to the queue (or fails them when out of attempts).
create or replace function public.release_stale_jobs(p_older_than interval)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_count integer;
begin
  with stale as (
    select id, attempts, max_attempts from public.import_jobs
    where status = 'running' and locked_at < now() - p_older_than
    for update skip locked
  )
  update public.import_jobs j
    set status = case when s.attempts >= s.max_attempts then 'failed' else 'queued' end,
        locked_at = null, locked_by = null,
        finished_at = case when s.attempts >= s.max_attempts then now() end,
        error_message = case when s.attempts >= s.max_attempts
          then 'The job stopped unexpectedly several times and has been abandoned.' else j.error_message end
  from stale s where j.id = s.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ── Integration secrets (encrypted by the application before storage) ───────
create or replace function public.save_integration_secret(p_connection_id uuid, p_ciphertext text)
returns void
language sql security definer set search_path = '' as $$
  insert into app_private.integration_secrets (connection_id, ciphertext) values (p_connection_id, p_ciphertext)
  on conflict (connection_id) do update set ciphertext = excluded.ciphertext, updated_at = now();
$$;

create or replace function public.read_integration_secret(p_connection_id uuid)
returns text
language sql security definer set search_path = '' as $$
  select ciphertext from app_private.integration_secrets where connection_id = p_connection_id;
$$;

create or replace function public.delete_integration_secret(p_connection_id uuid)
returns void
language sql security definer set search_path = '' as $$
  delete from app_private.integration_secrets where connection_id = p_connection_id;
$$;

-- ── Function privileges ─────────────────────────────────────────────────────
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.bootstrap_account(text, text) to authenticated;
grant execute on function public.create_pay_adjustment(uuid, uuid, date, text, numeric, text) to authenticated;
grant execute on function public.reverse_pay_adjustment(uuid, text) to authenticated;
grant execute on function public.record_driver_cover(uuid, date, uuid, uuid, text, text, text, numeric, numeric, text) to authenticated;
grant execute on function public.cancel_driver_cover(uuid, text) to authenticated;
grant execute on function public.set_cost_allocation(text, uuid, text, uuid, text) to authenticated;
grant execute on function public.link_earnings_to_driver(uuid, text, uuid, text) to authenticated;
grant execute on function public.resolve_earnings_conflict(uuid, text, text) to authenticated;

grant execute on all functions in schema public to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
