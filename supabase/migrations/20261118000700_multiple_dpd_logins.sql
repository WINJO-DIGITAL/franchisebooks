-- An account can hold several DPD portal logins (one per login that sees its franchises). Each login's username and
-- password are stored encrypted in app_private, never readable by users. Each franchise records which login reads it.
-- Accounts with the original single login keep working: that login is still used when no logins are listed here.

create table public.dpd_logins (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts (id) on delete cascade,
  label           text not null check (length(btrim(label)) between 1 and 80),
  username        text not null check (length(btrim(username)) between 1 and 200),
  last_success_at timestamptz,
  last_error      text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (account_id, username)
);
comment on table public.dpd_logins is 'DPD portal logins for an account. The password is in app_private.dpd_login_secrets.';

create table app_private.dpd_login_secrets (
  login_id    uuid primary key references public.dpd_logins (id) on delete cascade,
  ciphertext  text not null,
  updated_at  timestamptz not null default now()
);

alter table public.franchises add column if not exists dpd_login_id uuid references public.dpd_logins (id) on delete set null;
comment on column public.franchises.dpd_login_id is 'The DPD login that sees this franchise. Null = the account''s original login.';

alter table public.dpd_logins enable row level security;
alter table public.dpd_logins force row level security;

create policy dpd_logins_read on public.dpd_logins for select to authenticated
  using (account_id = (select app_private.current_account_id()));

create policy dpd_logins_insert on public.dpd_logins for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));

create policy dpd_logins_delete on public.dpd_logins for delete to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));

revoke all on public.dpd_logins from anon;
revoke update, truncate on public.dpd_logins from authenticated;

create trigger audit after insert or update or delete on public.dpd_logins for each row execute function app_private.audit_row();

create or replace function public.save_dpd_login_secret(p_login_id uuid, p_ciphertext text)
returns void
language sql security definer set search_path = '' as $$
  insert into app_private.dpd_login_secrets (login_id, ciphertext) values (p_login_id, p_ciphertext)
  on conflict (login_id) do update set ciphertext = excluded.ciphertext, updated_at = now();
$$;

create or replace function public.read_dpd_login_secret(p_login_id uuid)
returns text
language sql security definer set search_path = '' as $$
  select ciphertext from app_private.dpd_login_secrets where login_id = p_login_id;
$$;

revoke execute on function public.save_dpd_login_secret(uuid, text) from public, anon, authenticated;
revoke execute on function public.read_dpd_login_secret(uuid) from public, anon, authenticated;
grant execute on function public.save_dpd_login_secret(uuid, text) to service_role;
grant execute on function public.read_dpd_login_secret(uuid) to service_role;
