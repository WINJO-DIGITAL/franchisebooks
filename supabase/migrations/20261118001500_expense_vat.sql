-- The portal's Transaction Charges page states the VAT for each charge ("£11.47 (excl. £2.29 VAT)": the amount is before VAT,
-- and the VAT is what is added on top). Keep the stated VAT beside the amount. Null when the portal states none.

alter table public.expenses add column if not exists vat_amount numeric(12,2) check (vat_amount is null or vat_amount >= 0);
comment on column public.expenses.vat_amount is 'The VAT the portal states for this charge, added on top of amount. Null when none is stated.';

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
       source_driver_name, amount, vat_amount, transaction_ref, source, imported_file_id, dedupe_key)
    values
      (v_file.account_id, nullif(r ->> 'franchise_id', '')::uuid, (r ->> 'category_id')::uuid,
       (r ->> 'expense_date')::date, coalesce(r ->> 'description', ''), nullif(r ->> 'supplier', ''),
       nullif(r ->> 'vehicle_registration', ''), nullif(r ->> 'source_driver_name', ''), (r ->> 'amount')::numeric,
       nullif(r ->> 'vat_amount', '')::numeric,
       nullif(r ->> 'transaction_ref', ''), v_file.source, v_file.id, r ->> 'dedupe_key')
    on conflict (account_id, dedupe_key) do nothing
    returning id into v_id;

    if v_id is null then
      v_unchanged := v_unchanged + 1;
      -- A charge stored before the VAT was kept: fill in the VAT the portal states, never overwrite one already stored.
      update public.expenses set vat_amount = nullif(r ->> 'vat_amount', '')::numeric
        where account_id = v_file.account_id and dedupe_key = r ->> 'dedupe_key'
          and vat_amount is null and nullif(r ->> 'vat_amount', '') is not null;
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

revoke execute on function public.ingest_expenses(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_expenses(uuid, jsonb) to service_role;
