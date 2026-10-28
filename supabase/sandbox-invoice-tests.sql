create table public.billing_sandbox_runs (
 id uuid primary key,
 created_by uuid not null references auth.users(id),
 scenario text not null check(scenario in ('success','failure')),
 amount_cents integer not null default 2750 check(amount_cents=2750),
 currency text not null default 'aud' check(currency='aud'),
 customer_id text,
 intent_id text unique,
 status text not null default 'pending' check(status in ('pending','processing','paid','failed','requires_action')),
 last_event_id text,
 webhook_received_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.billing_sandbox_runs enable row level security;
revoke all on public.billing_sandbox_runs from public,anon,authenticated;
grant select on public.billing_sandbox_runs to authenticated;
grant all on public.billing_sandbox_runs to service_role;
create policy sandbox_owner_read on public.billing_sandbox_runs for select to authenticated using (created_by=(select auth.uid()) and exists(select 1 from public.platform_admins a where a.user_id=(select auth.uid())));
