-- DPD self-billed invoices, read from the invoice PDFs, with their lines.
-- Every amount is excluding VAT except invoice_total (net plus VAT).
-- Lines that the daily Payments already contain (stop pay, excess parcels) are kept here too; the app counts only the
-- extra lines (Fuel Supplement, C&D App, anything new) as "other DPD payments", dated at the period start.
-- Superseded on 19/11/2026 by docs/CORE.md rules 2 and 3: extras are listed on the Period Check and never counted as income.
create table public.dpd_invoices (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts (id) on delete restrict,
  franchise_id   uuid not null,
  invoice_no     text not null,
  invoice_date   date not null,
  due_date       date,
  period_start   date not null,
  period_end     date not null,
  net_total      numeric(12,2) not null,
  vat_total      numeric(12,2) not null,
  invoice_total  numeric(12,2) not null,
  lines          jsonb not null,
  reconciled     boolean not null,
  problems       jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  foreign key (franchise_id, account_id) references public.franchises (id, account_id) on delete restrict,
  unique (account_id, invoice_no),
  check (period_end >= period_start)
);
comment on table public.dpd_invoices is 'DPD self-billed invoices. Amounts exclude VAT except invoice_total. Written by the importer; read-only to users.';

create index dpd_invoices_period_idx on public.dpd_invoices (account_id, franchise_id, period_start);

alter table public.dpd_invoices enable row level security;

create policy dpd_invoices_read on public.dpd_invoices for select to authenticated
  using (account_id = (select app_private.current_account_id())
         and ((select app_private.has_all_franchises()) or app_private.can_access_franchise(franchise_id)));

revoke insert, update, delete, truncate on public.dpd_invoices from anon, authenticated;
