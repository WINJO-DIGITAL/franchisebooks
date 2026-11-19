-- Two plans: Standard (£49 a month per account) and Max (£99 a month per account, which adds the full history of
-- DPD figures back to the start of the previous tax year). The plan is recorded from the Stripe price the webhook sees.

alter table public.user_billing
  add column plan text not null default 'standard' check (plan in ('standard', 'max'));
comment on column public.user_billing.plan is 'Which plan the subscription is for: standard or max. Set by the Stripe webhook from the price bought.';

-- The plan of the signed-in person's account: their own subscription, or their business owner's. Null when they have no
-- access at all. Mirrors billing_allows_access().
create or replace function public.billing_plan()
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select b.plan from public.user_billing b
      where b.user_id = auth.uid() and b.status in ('active', 'trialing', 'past_due', 'comped')),
    (select b.plan
       from public.user_profiles me
       join public.user_profiles owner on owner.account_id = me.account_id and owner.role = 'owner'
       join public.user_billing b on b.user_id = owner.id
      where me.id = auth.uid() and b.status in ('active', 'trialing', 'past_due', 'comped'))
  );
$$;

revoke execute on function public.billing_plan() from public, anon;
grant execute on function public.billing_plan() to authenticated, service_role;
