begin;

create table if not exists public.broker_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  user_id uuid not null,
  broker_code text not null,
  title text not null default 'Mortgage Broker',
  contact_email text,
  contact_mobile text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id),
  unique (organisation_id, broker_code),
  foreign key (organisation_id, user_id)
    references public.organisation_memberships(organisation_id, user_id)
    on delete cascade,
  constraint broker_code_not_blank check (length(trim(broker_code)) > 0)
);

create index if not exists idx_broker_profiles_org_active
  on public.broker_profiles(organisation_id, is_active);

drop trigger if exists trg_broker_profiles_updated_at on public.broker_profiles;
create trigger trg_broker_profiles_updated_at
before update on public.broker_profiles
for each row execute function public.set_updated_at();

create or replace function private.can_view_broker_profile(
  p_organisation_id uuid,
  p_broker_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_platform_admin()
    or private.is_org_member(p_organisation_id)
    or exists (
      select 1
      from public.clients c
      join public.client_assignments ca
        on ca.client_id = c.id
       and ca.organisation_id = c.organisation_id
      where c.user_id = auth.uid()
        and c.organisation_id = p_organisation_id
        and ca.member_user_id = p_broker_user_id
    );
$$;

revoke all on function private.can_view_broker_profile(uuid, uuid) from public;
revoke all on function private.can_view_broker_profile(uuid, uuid) from anon;
revoke all on function private.can_view_broker_profile(uuid, uuid) from authenticated;

alter table public.broker_profiles enable row level security;

drop policy if exists broker_profiles_select_allowed on public.broker_profiles;
create policy broker_profiles_select_allowed
on public.broker_profiles
for select
to authenticated
using (private.can_view_broker_profile(organisation_id, user_id));

drop policy if exists broker_profiles_insert_admin on public.broker_profiles;
create policy broker_profiles_insert_admin
on public.broker_profiles
for insert
to authenticated
with check (
  private.is_platform_admin()
  or private.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

drop policy if exists broker_profiles_update_admin on public.broker_profiles;
create policy broker_profiles_update_admin
on public.broker_profiles
for update
to authenticated
using (
  private.is_platform_admin()
  or private.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
)
with check (
  private.is_platform_admin()
  or private.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

drop policy if exists broker_profiles_delete_admin on public.broker_profiles;
create policy broker_profiles_delete_admin
on public.broker_profiles
for delete
to authenticated
using (
  private.is_platform_admin()
  or private.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

revoke all on table public.broker_profiles from anon;
grant select, insert, update, delete on public.broker_profiles to authenticated;

commit;;
