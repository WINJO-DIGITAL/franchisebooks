-- Every row on the DPD portal is a fact. Two rows are the same record only when they are the same row read twice: the same
-- franchise, driver, day and route. Two routes on one day are two records, even if their figures happen to be identical, so the
-- earlier "identical figures are one record" rule is removed. The two spellings of a driver key (DR27903 and ref:dr27903) are
-- still one driver.

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
  v_excess integer; v_miles integer; v_stop_pay numeric(12,2); v_parcel_pay numeric(12,2);
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
    v_excess := nullif(r ->> 'excess_parcels', '')::integer;
    v_miles := nullif(r ->> 'mileage', '')::integer;
    v_stop_pay := nullif(r ->> 'stop_pay', '')::numeric;
    v_parcel_pay := nullif(r ->> 'parcel_pay', '')::numeric;

    -- Serialise concurrent imports of the same driver-day.
    perform pg_advisory_xact_lock(hashtextextended(v_franchise::text || '|' || lower(regexp_replace(v_key, '^ref:', '')) || '|' || v_date::text || '|' || coalesce(v_route, ''), 0));

    select * into v_existing from public.daily_earnings
      where franchise_id = v_franchise and report_date = v_date
        and lower(regexp_replace(driver_key, '^ref:', '')) = lower(regexp_replace(v_key, '^ref:', ''))
        and coalesce(route, '') = coalesce(v_route, '') and is_current
      order by created_at desc limit 1;

    if not found then
      insert into public.daily_earnings
        (account_id, franchise_id, driver_id, source_driver_name, source_driver_ref, driver_key, report_date, route,
         parcels, stops, pay_per_parcel, pay_per_stop, gross_earnings, deductions, additional_payments, net_earnings,
         imported_file_id, source, extraction_confidence, excess_parcels, mileage, stop_pay, parcel_pay)
      values
        (v_file.account_id, v_franchise, nullif(r ->> 'driver_id', '')::uuid, r ->> 'source_driver_name',
         nullif(r ->> 'source_driver_ref', ''), v_key, v_date, v_route, v_parcels, v_stops,
         nullif(r ->> 'pay_per_parcel', '')::numeric, nullif(r ->> 'pay_per_stop', '')::numeric,
         v_gross, v_ded, v_add, v_net, v_file.id, v_file.source, nullif(r ->> 'confidence', '')::numeric,
         v_excess, v_miles, v_stop_pay, v_parcel_pay);
      v_inserted := v_inserted + 1;
    elsif (v_existing.gross_earnings, v_existing.deductions, v_existing.additional_payments, v_existing.net_earnings,
           v_existing.parcels, v_existing.stops)
          is not distinct from (v_gross, v_ded, v_add, v_net, v_parcels, v_stops) then
      v_unchanged := v_unchanged + 1;
      if v_existing.driver_id is null and nullif(r ->> 'driver_id', '') is not null then
        update public.daily_earnings set driver_id = (r ->> 'driver_id')::uuid where id = v_existing.id;
      end if;
      -- Rows imported before these details were read get them filled in; nothing already stored is overwritten.
      if (v_existing.excess_parcels is null and v_excess is not null) or (v_existing.mileage is null and v_miles is not null)
         or (v_existing.stop_pay is null and v_stop_pay is not null) or (v_existing.parcel_pay is null and v_parcel_pay is not null) then
        update public.daily_earnings
          set excess_parcels = coalesce(excess_parcels, v_excess), mileage = coalesce(mileage, v_miles),
              stop_pay = coalesce(stop_pay, v_stop_pay), parcel_pay = coalesce(parcel_pay, v_parcel_pay)
          where id = v_existing.id;
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

revoke execute on function public.ingest_earnings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_earnings(uuid, jsonb) to service_role;
