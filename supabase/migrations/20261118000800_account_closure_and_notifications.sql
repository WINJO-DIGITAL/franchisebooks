-- Closing an account: a recorded request, so the owner's wish is kept and what happens next is traceable.
-- Financial records are kept for the period the law requires (see the terms); this only records the request.

create table public.account_closure_requests (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete restrict,
  requested_by  uuid references auth.users (id) on delete set null,
  requested_at  timestamptz not null default now(),
  status        text not null default 'requested' check (status in ('requested', 'completed', 'cancelled')),
  completed_at  timestamptz,
  note          text check (note is null or length(note) <= 1000)
);

alter table public.account_closure_requests enable row level security;
alter table public.account_closure_requests force row level security;

create policy account_closure_requests_read on public.account_closure_requests for select to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));

create policy account_closure_requests_insert on public.account_closure_requests for insert to authenticated
  with check (account_id = (select app_private.current_account_id()) and (select app_private.can_write()));

revoke all on public.account_closure_requests from anon;
revoke update, delete, truncate on public.account_closure_requests from authenticated;
create trigger audit after insert or update or delete on public.account_closure_requests for each row execute function app_private.audit_row();
