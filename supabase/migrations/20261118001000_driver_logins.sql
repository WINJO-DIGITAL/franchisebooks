-- Driver logins: a driver can sign in and see only their own days and pay.
--
-- A driver login deliberately has NO row in user_profiles. Every access rule in the app is built from the signed-in
-- user's profile (app_private.current_account_id() and friends), so a login without a profile can read nothing from any
-- business table. The driver's pages read their own data through the server, scoped to the driver recorded here.

create table public.driver_accounts (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  account_id  uuid not null references public.accounts (id) on delete cascade,
  driver_id   uuid not null,
  email       text not null check (length(email) between 3 and 320),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (driver_id, account_id) references public.drivers (id, account_id) on delete cascade,
  unique (driver_id)
);
comment on table public.driver_accounts is 'Links a driver''s own login to their driver record. One login per driver. Written only by the server.';

alter table public.driver_accounts enable row level security;
alter table public.driver_accounts force row level security;

-- A driver can read their own link (so the app knows who they are); owners and managers can read their account's links.
create policy driver_accounts_read_own on public.driver_accounts for select to authenticated
  using (user_id = (select auth.uid()));

create policy driver_accounts_read_account on public.driver_accounts for select to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));

revoke all on public.driver_accounts from anon;
revoke insert, update, delete, truncate on public.driver_accounts from authenticated;

create trigger audit after insert or update or delete on public.driver_accounts for each row execute function app_private.audit_row();

-- A login is either a driver login or a business user, never both. This is what keeps a driver away from business data, so
-- the database refuses the combination whichever way round it is attempted.
create or replace function app_private.forbid_driver_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.driver_accounts where user_id = new.id) then
    raise exception 'A driver login cannot also be set up as a business user.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger forbid_driver_profile before insert on public.user_profiles
  for each row execute function app_private.forbid_driver_profile();

create or replace function app_private.forbid_profile_driver() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.user_profiles where id = new.user_id) then
    raise exception 'A business user cannot also be given a driver login.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger forbid_profile_driver before insert on public.driver_accounts
  for each row execute function app_private.forbid_profile_driver();
