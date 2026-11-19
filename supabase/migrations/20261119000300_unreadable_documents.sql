-- DPD documents the nightly sync could not read. The original PDF and the recognised text are kept in the private
-- "diagnostics" bucket so the owner can look at them. One row per document number, updated each night it is seen again.
create table public.unreadable_documents (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts (id) on delete restrict,
  franchise_id   uuid not null references public.franchises (id) on delete restrict,
  document_no    text not null check (length(document_no) between 1 and 40),
  status         text not null check (status in ('unreadable', 'incomplete', 'wrong_franchise', 'credit_note')),
  reason         text not null check (length(reason) <= 1000),
  pdf_path       text,
  text_path      text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  resolved_at    timestamptz,
  unique (account_id, document_no)
);
create index unreadable_documents_open_idx on public.unreadable_documents (account_id, last_seen_at desc) where resolved_at is null;
comment on table public.unreadable_documents is 'DPD documents the sync could not read, with where their original PDF is kept. Owners only; written only by the server.';
alter table public.unreadable_documents enable row level security;
alter table public.unreadable_documents force row level security;
-- Only the business owner may see these (they can show figures from every franchise).
create policy unreadable_documents_read on public.unreadable_documents for select to authenticated
  using (account_id = (select app_private.current_account_id()) and (select app_private.is_owner()));
revoke all on public.unreadable_documents from anon, authenticated;
grant select on public.unreadable_documents to authenticated;
grant all on public.unreadable_documents to service_role;
