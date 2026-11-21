-- A driver who is the franchisee themselves. They do not need a day rate set, so the dashboard does not ask for one.
alter table public.drivers add column if not exists is_franchisee boolean not null default false;
comment on column public.drivers.is_franchisee is 'True when this person is the franchisee: no pay rate is asked for.';
