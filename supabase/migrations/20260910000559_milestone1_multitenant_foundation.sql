begin;

create extension if not exists pgcrypto;

do $$ begin
  create type public.organisation_status as enum ('trial', 'active', 'suspended', 'closed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.membership_role as enum ('company_admin', 'broker', 'broker_assistant');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.membership_status as enum ('invited', 'active', 'disabled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.client_status as enum ('lead', 'active', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.assignment_role as enum ('primary_broker', 'broker', 'assistant');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.invitation_status as enum ('pending', 'claimed', 'expired', 'revoked');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  mobile text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  abn text,
  billing_email text,
  contact_phone text,
  website text,
  logo_url text,
  status public.organisation_status not null default 'trial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organisations_name_not_blank check (length(trim(name)) > 0)
);

create table if not exists public.organisation_memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.membership_role not null,
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create unique index if not exists uq_memberships_org_user
  on public.organisation_memberships(organisation_id, user_id);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text,
  mobile text,
  status public.client_status not null default 'lead',
  created_by_user_id uuid references auth.users(id) on delete set null,
  connected_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id),
  constraint clients_name_not_blank
    check (length(trim(first_name)) > 0 and length(trim(last_name)) > 0)
);

create unique index if not exists uq_clients_org_user_nonnull
  on public.clients(organisation_id, user_id)
  where user_id is not null;

create index if not exists idx_clients_org_status
  on public.clients(organisation_id, status);

create index if not exists idx_clients_user
  on public.clients(user_id)
  where user_id is not null;

create table if not exists public.client_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  client_id uuid not null,
  member_user_id uuid not null,
  assignment_role public.assignment_role not null default 'broker',
  created_at timestamptz not null default now(),
  unique (client_id, member_user_id),
  foreign key (client_id, organisation_id)
    references public.clients(id, organisation_id)
    on delete cascade,
  foreign key (organisation_id, member_user_id)
    references public.organisation_memberships(organisation_id, user_id)
    on delete cascade
);

create unique index if not exists uq_primary_broker_per_client
  on public.client_assignments(client_id)
  where assignment_role = 'primary_broker';

create index if not exists idx_client_assignments_member
  on public.client_assignments(organisation_id, member_user_id);

create table if not exists public.client_invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  broker_user_id uuid not null,
  token_hash text not null unique,
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organisation_id, broker_user_id)
    references public.organisation_memberships(organisation_id, user_id)
    on delete cascade,
  constraint invitation_expiry_after_creation check (expires_at > created_at)
);

create index if not exists idx_client_invitations_org_broker
  on public.client_invitations(organisation_id, broker_user_id, status);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  organisation_id uuid references public.organisations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_org_created
  on public.audit_events(organisation_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_organisations_updated_at on public.organisations;
create trigger trg_organisations_updated_at
before update on public.organisations
for each row execute function public.set_updated_at();

drop trigger if exists trg_memberships_updated_at on public.organisation_memberships;
create trigger trg_memberships_updated_at
before update on public.organisation_memberships
for each row execute function public.set_updated_at();

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, first_name, last_name, mobile)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'mobile', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_member(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_memberships om
    where om.organisation_id = p_organisation_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  );
$$;

create or replace function public.has_org_role(
  p_organisation_id uuid,
  p_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_memberships om
    where om.organisation_id = p_organisation_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role = any(p_roles)
  );
$$;

create or replace function public.is_client_owner(
  p_organisation_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.organisation_id = p_organisation_id
      and c.user_id = auth.uid()
  );
$$;

create or replace function public.is_assigned_staff(
  p_organisation_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_assignments ca
    join public.organisation_memberships om
      on om.organisation_id = ca.organisation_id
     and om.user_id = ca.member_user_id
    where ca.organisation_id = p_organisation_id
      and ca.client_id = p_client_id
      and ca.member_user_id = auth.uid()
      and om.status = 'active'
  );
$$;

create or replace function public.can_staff_access_client(
  p_organisation_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_platform_admin()
    or public.has_org_role(
      p_organisation_id,
      array['company_admin']::public.membership_role[]
    )
    or public.is_assigned_staff(p_organisation_id, p_client_id);
$$;

create or replace function public.can_access_client(
  p_organisation_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.can_staff_access_client(p_organisation_id, p_client_id)
    or public.is_client_owner(p_organisation_id, p_client_id);
$$;

create or replace function public.can_view_profile(p_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() = p_target_user_id
    or public.is_platform_admin()
    or exists (
      select 1
      from public.organisation_memberships mine
      join public.organisation_memberships theirs
        on theirs.organisation_id = mine.organisation_id
      where mine.user_id = auth.uid()
        and mine.status = 'active'
        and theirs.user_id = p_target_user_id
        and theirs.status = 'active'
    )
    or exists (
      select 1
      from public.clients c
      join public.client_assignments ca
        on ca.client_id = c.id
       and ca.organisation_id = c.organisation_id
      where c.user_id = auth.uid()
        and ca.member_user_id = p_target_user_id
    );
$$;

revoke all on function public.is_platform_admin() from public;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, public.membership_role[]) from public;
revoke all on function public.is_client_owner(uuid, uuid) from public;
revoke all on function public.is_assigned_staff(uuid, uuid) from public;
revoke all on function public.can_staff_access_client(uuid, uuid) from public;
revoke all on function public.can_access_client(uuid, uuid) from public;
revoke all on function public.can_view_profile(uuid) from public;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.membership_role[]) to authenticated;
grant execute on function public.is_client_owner(uuid, uuid) to authenticated;
grant execute on function public.is_assigned_staff(uuid, uuid) to authenticated;
grant execute on function public.can_staff_access_client(uuid, uuid) to authenticated;
grant execute on function public.can_access_client(uuid, uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organisations enable row level security;
alter table public.organisation_memberships enable row level security;
alter table public.clients enable row level security;
alter table public.client_assignments enable row level security;
alter table public.client_invitations enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists profiles_select_allowed on public.profiles;
create policy profiles_select_allowed
on public.profiles
for select
to authenticated
using (public.can_view_profile(id));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists platform_admins_select_self on public.platform_admins;
create policy platform_admins_select_self
on public.platform_admins
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists organisations_select_allowed on public.organisations;
create policy organisations_select_allowed
on public.organisations
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_org_member(id)
  or exists (
    select 1
    from public.clients c
    where c.organisation_id = organisations.id
      and c.user_id = auth.uid()
  )
);

drop policy if exists organisations_insert_platform_admin on public.organisations;
create policy organisations_insert_platform_admin
on public.organisations
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists organisations_update_allowed on public.organisations;
create policy organisations_update_allowed
on public.organisations
for update
to authenticated
using (
  public.is_platform_admin()
  or public.has_org_role(id, array['company_admin']::public.membership_role[])
)
with check (
  public.is_platform_admin()
  or public.has_org_role(id, array['company_admin']::public.membership_role[])
);

drop policy if exists memberships_select_allowed on public.organisation_memberships;
create policy memberships_select_allowed
on public.organisation_memberships
for select
to authenticated
using (
  public.is_platform_admin()
  or user_id = auth.uid()
  or public.is_org_member(organisation_id)
);

drop policy if exists memberships_insert_admin on public.organisation_memberships;
create policy memberships_insert_admin
on public.organisation_memberships
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

drop policy if exists memberships_update_admin on public.organisation_memberships;
create policy memberships_update_admin
on public.organisation_memberships
for update
to authenticated
using (
  public.is_platform_admin()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
)
with check (
  public.is_platform_admin()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

drop policy if exists memberships_delete_admin on public.organisation_memberships;
create policy memberships_delete_admin
on public.organisation_memberships
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

drop policy if exists clients_select_allowed on public.clients;
create policy clients_select_allowed
on public.clients
for select
to authenticated
using (public.can_access_client(organisation_id, id));

drop policy if exists clients_insert_staff on public.clients;
create policy clients_insert_staff
on public.clients
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.has_org_role(
    organisation_id,
    array['company_admin','broker']::public.membership_role[]
  )
);

drop policy if exists clients_update_staff on public.clients;
create policy clients_update_staff
on public.clients
for update
to authenticated
using (public.can_staff_access_client(organisation_id, id))
with check (public.can_staff_access_client(organisation_id, id));

drop policy if exists assignments_select_allowed on public.client_assignments;
create policy assignments_select_allowed
on public.client_assignments
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_org_member(organisation_id)
  or public.is_client_owner(organisation_id, client_id)
);

drop policy if exists assignments_insert_admin on public.client_assignments;
create policy assignments_insert_admin
on public.client_assignments
for insert
to authenticated
with check (
  public.is_platform_admin()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

drop policy if exists assignments_update_admin on public.client_assignments;
create policy assignments_update_admin
on public.client_assignments
for update
to authenticated
using (
  public.is_platform_admin()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
)
with check (
  public.is_platform_admin()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

drop policy if exists assignments_delete_admin on public.client_assignments;
create policy assignments_delete_admin
on public.client_assignments
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

drop policy if exists invitations_select_staff on public.client_invitations;
create policy invitations_select_staff
on public.client_invitations
for select
to authenticated
using (
  public.is_platform_admin()
  or broker_user_id = auth.uid()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

drop policy if exists invitations_insert_staff on public.client_invitations;
create policy invitations_insert_staff
on public.client_invitations
for insert
to authenticated
with check (
  public.is_platform_admin()
  or (
    broker_user_id = auth.uid()
    and public.has_org_role(
      organisation_id,
      array['company_admin','broker']::public.membership_role[]
    )
  )
);

drop policy if exists invitations_update_staff on public.client_invitations;
create policy invitations_update_staff
on public.client_invitations
for update
to authenticated
using (
  public.is_platform_admin()
  or broker_user_id = auth.uid()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
)
with check (
  public.is_platform_admin()
  or broker_user_id = auth.uid()
  or public.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

drop policy if exists audit_select_allowed on public.audit_events;
create policy audit_select_allowed
on public.audit_events
for select
to authenticated
using (
  public.is_platform_admin()
  or (
    organisation_id is not null
    and public.has_org_role(
      organisation_id,
      array['company_admin']::public.membership_role[]
    )
  )
);

revoke all on table public.profiles from anon;
revoke all on table public.platform_admins from anon;
revoke all on table public.organisations from anon;
revoke all on table public.organisation_memberships from anon;
revoke all on table public.clients from anon;
revoke all on table public.client_assignments from anon;
revoke all on table public.client_invitations from anon;
revoke all on table public.audit_events from anon;

grant select, update on public.profiles to authenticated;
grant select on public.platform_admins to authenticated;
grant select, insert, update on public.organisations to authenticated;
grant select, insert, update, delete on public.organisation_memberships to authenticated;
grant select, insert, update on public.clients to authenticated;
grant select, insert, update, delete on public.client_assignments to authenticated;
grant select, insert, update on public.client_invitations to authenticated;
grant select on public.audit_events to authenticated;

grant usage, select on sequence public.audit_events_id_seq to authenticated;

commit;;
