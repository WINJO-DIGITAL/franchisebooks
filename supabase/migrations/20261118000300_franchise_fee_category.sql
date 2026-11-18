-- "Franchise fee" is an expense DPD lists among the invoices. Add it as a built-in category for every
-- existing account, and for new accounts via bootstrap_account.
-- (Credit notes are not modelled yet: expenses cannot be negative and what they cover is still unconfirmed.)

insert into public.expense_categories (account_id, name, kind, is_system, sort_order)
select a.id, 'Franchise fee', 'other', true, 85
from public.accounts a
where not exists (
  select 1 from public.expense_categories c where c.account_id = a.id and lower(c.name) = 'franchise fee'
);

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
    (v_account, 'Franchise fee', 'other', true, 85),
    (v_account, 'Other operating expenses', 'other', true, 90);
  return v_account;
end $$;

-- Function privileges: recreated functions keep their grants, but state them so this file is self-contained.
revoke execute on function public.bootstrap_account(text, text) from public, anon;
grant execute on function public.bootstrap_account(text, text) to authenticated;
