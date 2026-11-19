-- One-off DPD documents with no billing period: "Support Payment" invoices (such as Business start) and "Self Billed VAT
-- Only" invoices, which add VAT to earlier invoices. Additive: every existing invoice is a normal period invoice.
alter table public.dpd_invoices
  add column kind text not null default 'period' check (kind in ('period', 'support_payment', 'vat_only')),
  add column refers_to jsonb not null default '[]'::jsonb check (jsonb_typeof(refers_to) = 'array');
comment on column public.dpd_invoices.kind is 'period = the usual four-weekly self-billed invoice; support_payment = a one-off payment (dated on its invoice date, period_start = period_end = invoice_date); vat_only = VAT added to earlier invoices, no net of its own.';
comment on column public.dpd_invoices.refers_to is 'For a vat_only invoice: the earlier invoices it adds VAT to, as [{invoiceNo, docDate, net, vat}] in pence. Empty otherwise.';
