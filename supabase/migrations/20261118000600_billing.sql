-- Billing: one subscription per paying user (the account owner). A person pays before their business exists, so the
-- subscription is keyed by user, and access for the rest of an account follows its owner's subscription.
-- Written only by the Stripe webhook (service role); a signed-in user can read their own row.

create table public.user_billing (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  status                  text not null default 'incomplete'
                          check (status in ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused', 'comped')),
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  updated_at              timestamptz not null default now()
);
comment on table public.user_billing is 'Subscription state per paying user, kept in step with Stripe by the webhook. "comped" = access without paying (existing accounts, gifts).';

alter table public.user_billing enable row level security;
alter table public.user_billing force row level security;

create policy user_billing_read on public.user_billing for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_billing from anon;
revoke insert, update, delete, truncate on public.user_billing from authenticated;

create trigger touch_updated_at before update on public.user_billing for each row execute function app_private.touch_updated_at();

-- Everyone who already has a business keeps full access, free.
insert into public.user_billing (user_id, status)
select id, 'comped' from public.user_profiles
on conflict (user_id) do nothing;

-- True when the signed-in user may use the app: they hold a paid (or comped) subscription themselves, or the owner of
-- their business does. Statuses that count as access: active, trialing, past_due (Stripe is still retrying), comped.
create or replace function public.billing_allows_access()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_billing b
    where b.user_id = auth.uid() and b.status in ('active', 'trialing', 'past_due', 'comped')
  ) or exists (
    select 1
    from public.user_profiles me
    join public.user_profiles owner on owner.account_id = me.account_id and owner.role = 'owner'
    join public.user_billing b on b.user_id = owner.id
    where me.id = auth.uid() and b.status in ('active', 'trialing', 'past_due', 'comped')
  );
$$;

revoke execute on function public.billing_allows_access() from public, anon;
grant execute on function public.billing_allows_access() to authenticated, service_role;
