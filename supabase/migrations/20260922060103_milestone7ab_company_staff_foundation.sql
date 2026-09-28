-- BrokerRelay v0.7.0 — Milestone 7A/7B company and staff management
-- Review payload. The installer creates the timestamped migration with
-- `supabase migration new` and copies this payload into it.

begin;

do $$ begin
  create type public.staff_role as enum (
    'head_broker', 'broker', 'administrator', 'accounts', 'hr', 'broker_assistant'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.staff_permission as enum (
    'manage_company', 'manage_staff', 'transfer_clients',
    'manage_announcements', 'view_finance', 'manage_finance', 'manage_hr'
  );
exception when duplicate_object then null;
end $$;

alter table public.organisation_memberships
  add column if not exists invited_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists disabled_reason text;

update public.organisation_memberships
set activated_at = coalesce(activated_at, created_at)
where status = 'active' and activated_at is null;

create table if not exists public.organisation_member_roles (
  membership_id uuid not null references public.organisation_memberships(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.staff_role not null,
  granted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (membership_id, role),
  unique (organisation_id, user_id, role),
  foreign key (organisation_id, user_id)
    references public.organisation_memberships(organisation_id, user_id) on delete cascade
);

create index if not exists idx_member_roles_org_role
  on public.organisation_member_roles(organisation_id, role, user_id);
create index if not exists idx_member_roles_user
  on public.organisation_member_roles(user_id, organisation_id);

create table if not exists public.organisation_member_permissions (
  membership_id uuid not null references public.organisation_memberships(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission public.staff_permission not null,
  granted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (membership_id, permission),
  unique (organisation_id, user_id, permission),
  foreign key (organisation_id, user_id)
    references public.organisation_memberships(organisation_id, user_id) on delete cascade
);

create index if not exists idx_member_permissions_org_permission
  on public.organisation_member_permissions(organisation_id, permission, user_id);

create table if not exists public.client_transfer_batches (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete restrict,
  to_user_id uuid not null references auth.users(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  reason text,
  client_count integer not null default 0 check (client_count >= 0),
  created_at timestamptz not null default now(),
  constraint transfer_users_differ check (from_user_id <> to_user_id)
);

create index if not exists idx_transfer_batches_org_created
  on public.client_transfer_batches(organisation_id, created_at desc);

create table if not exists public.client_transfer_items (
  batch_id uuid not null references public.client_transfer_batches(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  assignment_role public.assignment_role not null,
  created_at timestamptz not null default now(),
  primary key (batch_id, client_id, assignment_role)
);

create index if not exists idx_transfer_items_client
  on public.client_transfer_items(client_id, created_at desc);

-- Backfill multi-role rows while preserving the legacy primary role column.
insert into public.organisation_member_roles (membership_id, organisation_id, user_id, role)
select id, organisation_id, user_id,
  case role
    when 'company_admin' then 'administrator'::public.staff_role
    when 'broker' then 'broker'::public.staff_role
    else 'broker_assistant'::public.staff_role
  end
from public.organisation_memberships
on conflict do nothing;

-- Every original company administrator becomes a Head Broker as the safe
-- initial owner. A later reviewed migration may separate those responsibilities.
insert into public.organisation_member_roles (membership_id, organisation_id, user_id, role)
select id, organisation_id, user_id, 'head_broker'::public.staff_role
from public.organisation_memberships
where role = 'company_admin'
on conflict do nothing;

create or replace function private.has_staff_role(
  p_organisation_id uuid,
  p_roles public.staff_role[]
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
    join public.organisation_member_roles mr on mr.membership_id = om.id
    join public.organisations o on o.id = om.organisation_id
    where om.organisation_id = p_organisation_id
      and om.user_id = (select auth.uid())
      and om.status = 'active'
      and o.status in ('trial', 'active')
      and mr.role = any(p_roles)
  );
$$;

create or replace function private.has_staff_permission(
  p_organisation_id uuid,
  p_permission public.staff_permission
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or private.has_staff_role(p_organisation_id, array['head_broker']::public.staff_role[])
    or (
      p_permission in ('manage_company','manage_staff','transfer_clients','manage_announcements')
      and private.has_staff_role(p_organisation_id, array['administrator']::public.staff_role[])
    )
    or (
      p_permission in ('view_finance','manage_finance')
      and private.has_staff_role(p_organisation_id, array['accounts']::public.staff_role[])
    )
    or (
      p_permission = 'manage_hr'
      and private.has_staff_role(p_organisation_id, array['hr']::public.staff_role[])
    )
    or exists (
      select 1
      from public.organisation_memberships om
      join public.organisation_member_permissions mp on mp.membership_id = om.id
      join public.organisations o on o.id = om.organisation_id
      where om.organisation_id = p_organisation_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
        and o.status in ('trial', 'active')
        and mp.permission = p_permission
    );
$$;

create or replace function private.is_org_member(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_memberships om
    join public.organisations o on o.id = om.organisation_id
    where om.organisation_id = p_organisation_id
      and om.user_id = (select auth.uid())
      and om.status = 'active'
      and o.status in ('trial', 'active')
  );
$$;

-- Compatibility bridge for Milestones 1–6. Existing policies keep working,
-- while new multi-role records become authoritative.
create or replace function private.has_org_role(
  p_organisation_id uuid,
  p_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or exists (
      select 1
      from public.organisation_memberships om
      join public.organisations o on o.id = om.organisation_id
      where om.organisation_id = p_organisation_id
        and om.user_id = (select auth.uid())
        and om.status = 'active'
        and o.status in ('trial', 'active')
        and (
          om.role = any(p_roles)
          or (
            'company_admin'::public.membership_role = any(p_roles)
            and private.has_staff_permission(p_organisation_id, 'manage_staff')
          )
          or (
            'broker'::public.membership_role = any(p_roles)
            and private.has_staff_role(
              p_organisation_id,
              array['head_broker','broker']::public.staff_role[]
            )
          )
          or (
            'broker_assistant'::public.membership_role = any(p_roles)
            and private.has_staff_role(
              p_organisation_id,
              array['broker_assistant']::public.staff_role[]
            )
          )
        )
    );
$$;

create or replace function private.is_assigned_staff(p_organisation_id uuid, p_client_id uuid)
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
      on om.organisation_id = ca.organisation_id and om.user_id = ca.member_user_id
    join public.organisations o on o.id = om.organisation_id
    where ca.organisation_id = p_organisation_id
      and ca.client_id = p_client_id
      and ca.member_user_id = (select auth.uid())
      and om.status = 'active'
      and o.status in ('trial', 'active')
  );
$$;

create or replace function private.legacy_role_for_staff(p_roles public.staff_role[])
returns public.membership_role
language sql
immutable
set search_path = ''
as $$
  select case
    when p_roles && array['head_broker','administrator']::public.staff_role[]
      then 'company_admin'::public.membership_role
    when 'broker'::public.staff_role = any(p_roles)
      then 'broker'::public.membership_role
    else 'broker_assistant'::public.membership_role
  end;
$$;

create or replace function public.admin_get_company_snapshot(p_organisation_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_result jsonb;
begin
  select coalesce(p_organisation_id, min(om.organisation_id)) into v_org
  from public.organisation_memberships om
  where om.user_id = (select auth.uid()) and om.status = 'active';

  if v_org is null or not private.has_staff_permission(v_org, 'manage_staff') then
    raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'organisation', jsonb_build_object(
      'id', o.id, 'name', o.name, 'legal_name', o.legal_name, 'abn', o.abn,
      'billing_email', o.billing_email, 'contact_phone', o.contact_phone,
      'website', o.website, 'status', o.status
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membership_id', om.id,
        'user_id', om.user_id,
        'email', au.email,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'status', om.status,
        'disabled_reason', om.disabled_reason,
        'roles', coalesce((select jsonb_agg(mr.role order by mr.role)
                           from public.organisation_member_roles mr
                           where mr.membership_id = om.id), '[]'::jsonb),
        'permissions', coalesce((select jsonb_agg(mp.permission order by mp.permission)
                                 from public.organisation_member_permissions mp
                                 where mp.membership_id = om.id), '[]'::jsonb),
        'assigned_clients', (select count(*) from public.client_assignments ca
                             where ca.organisation_id = om.organisation_id
                               and ca.member_user_id = om.user_id)
      ) order by p.first_name, p.last_name, au.email)
      from public.organisation_memberships om
      join auth.users au on au.id = om.user_id
      left join public.profiles p on p.id = om.user_id
      where om.organisation_id = o.id
    ), '[]'::jsonb)
  ) into v_result
  from public.organisations o where o.id = v_org;

  return v_result;
end;
$$;

create or replace function public.admin_set_staff_roles(
  p_organisation_id uuid,
  p_user_id uuid,
  p_roles public.staff_role[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.organisation_memberships%rowtype;
  v_role public.staff_role;
  v_heads integer;
begin
  if not private.has_staff_permission(p_organisation_id, 'manage_staff') then
    raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode = '42501';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'AT_LEAST_ONE_ROLE_REQUIRED' using errcode = '22023';
  end if;
  if 'head_broker'::public.staff_role = any(p_roles)
     and not private.is_platform_admin()
     and not private.has_staff_role(p_organisation_id, array['head_broker']::public.staff_role[]) then
    raise exception 'HEAD_BROKER_ROLE_REQUIRES_HEAD_BROKER' using errcode = '42501';
  end if;
  if cardinality(p_roles) <> (select count(distinct x) from unnest(p_roles) x) then
    raise exception 'DUPLICATE_ROLE' using errcode = '22023';
  end if;

  perform 1 from public.organisations where id = p_organisation_id for update;
  select * into v_membership from public.organisation_memberships
  where organisation_id = p_organisation_id and user_id = p_user_id for update;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;

  if exists (select 1 from public.organisation_member_roles
             where membership_id = v_membership.id and role = 'head_broker')
     and not private.is_platform_admin()
     and not private.has_staff_role(p_organisation_id, array['head_broker']::public.staff_role[]) then
    raise exception 'HEAD_BROKER_ROLE_REQUIRES_HEAD_BROKER' using errcode = '42501';
  end if;

  if exists (select 1 from public.organisation_member_roles
             where membership_id = v_membership.id and role = 'head_broker')
     and not ('head_broker'::public.staff_role = any(p_roles))
     and v_membership.status = 'active' then
    select count(*) into v_heads
    from public.organisation_memberships om
    join public.organisation_member_roles mr on mr.membership_id = om.id
    where om.organisation_id = p_organisation_id and om.status = 'active'
      and mr.role = 'head_broker';
    if v_heads <= 1 then raise exception 'FINAL_HEAD_BROKER_REQUIRED' using errcode = '23514'; end if;
  end if;

  delete from public.organisation_member_roles where membership_id = v_membership.id;
  foreach v_role in array p_roles loop
    insert into public.organisation_member_roles
      (membership_id, organisation_id, user_id, role, granted_by_user_id)
    values (v_membership.id, p_organisation_id, p_user_id, v_role, (select auth.uid()));
  end loop;
  update public.organisation_memberships
  set role = private.legacy_role_for_staff(p_roles), updated_at = now()
  where id = v_membership.id;

  if p_roles && array['head_broker','broker']::public.staff_role[] then
    insert into public.broker_profiles
      (organisation_id, user_id, broker_code, title, is_active)
    values (p_organisation_id, p_user_id,
      'BR-' || upper(substr(replace(p_user_id::text, '-', ''), 1, 8)),
      case when 'head_broker'::public.staff_role = any(p_roles) then 'Head Broker' else 'Mortgage Broker' end,
      true)
    on conflict (organisation_id, user_id) do update set is_active = true, updated_at = now();
  else
    update public.broker_profiles set is_active = false, updated_at = now()
    where organisation_id = p_organisation_id and user_id = p_user_id;
  end if;

  insert into public.audit_events
    (organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_organisation_id, (select auth.uid()), 'staff_roles_changed',
          'organisation_membership', v_membership.id, jsonb_build_object('roles', p_roles));
end;
$$;

-- Service-only invitation helpers. The Edge Function authenticates the JWT;
-- these functions independently re-check the actor supplied by that function.
create or replace function private.actor_can_manage_staff(
  p_actor_user_id uuid,
  p_organisation_id uuid
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
    join public.organisations o on o.id = om.organisation_id
    where om.organisation_id = p_organisation_id
      and om.user_id = p_actor_user_id
      and om.status = 'active'
      and o.status in ('trial','active')
      and (
        exists (select 1 from public.organisation_member_roles mr
                where mr.membership_id = om.id and mr.role in ('head_broker','administrator'))
        or exists (select 1 from public.organisation_member_permissions mp
                   where mp.membership_id = om.id and mp.permission = 'manage_staff')
      )
  );
$$;

create or replace function public.service_find_user_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

create or replace function public.service_add_invited_staff(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_user_id uuid,
  p_roles public.staff_role[],
  p_broker_code text default null,
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_role public.staff_role;
  v_user_confirmed boolean;
begin
  if not private.actor_can_manage_staff(p_actor_user_id, p_organisation_id) then
    raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode = '42501';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'AT_LEAST_ONE_ROLE_REQUIRED' using errcode = '22023';
  end if;
  if 'head_broker'::public.staff_role = any(p_roles) and not exists (
    select 1 from public.organisation_memberships om
    join public.organisation_member_roles mr on mr.membership_id = om.id
    where om.organisation_id = p_organisation_id and om.user_id = p_actor_user_id
      and om.status = 'active' and mr.role = 'head_broker'
  ) then raise exception 'HEAD_BROKER_ROLE_REQUIRES_HEAD_BROKER' using errcode = '42501'; end if;

  select email_confirmed_at is not null into v_user_confirmed from auth.users where id = p_user_id;
  if not found then raise exception 'AUTH_USER_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.organisation_memberships
    (organisation_id, user_id, role, status, invited_at, activated_at)
  values (
    p_organisation_id, p_user_id, private.legacy_role_for_staff(p_roles),
    case when v_user_confirmed then 'active'::public.membership_status else 'invited'::public.membership_status end,
    now(), case when v_user_confirmed then now() else null end
  )
  on conflict (organisation_id, user_id) do update set
    role = excluded.role,
    status = case when organisation_memberships.status = 'disabled'
                  then organisation_memberships.status else excluded.status end,
    invited_at = coalesce(organisation_memberships.invited_at, excluded.invited_at),
    updated_at = now()
  returning id into v_membership_id;

  delete from public.organisation_member_roles where membership_id = v_membership_id;
  foreach v_role in array p_roles loop
    insert into public.organisation_member_roles
      (membership_id, organisation_id, user_id, role, granted_by_user_id)
    values (v_membership_id, p_organisation_id, p_user_id, v_role, p_actor_user_id);
  end loop;

  if p_roles && array['head_broker','broker']::public.staff_role[] then
    insert into public.broker_profiles
      (organisation_id, user_id, broker_code, title, is_active)
    values (
      p_organisation_id, p_user_id,
      coalesce(nullif(trim(p_broker_code), ''), 'BR-' || upper(substr(replace(p_user_id::text, '-', ''), 1, 8))),
      coalesce(nullif(trim(p_title), ''), case when 'head_broker'::public.staff_role = any(p_roles)
        then 'Head Broker' else 'Mortgage Broker' end),
      v_user_confirmed
    )
    on conflict (organisation_id, user_id) do update set
      broker_code = excluded.broker_code, title = excluded.title,
      is_active = excluded.is_active, updated_at = now();
  end if;

  insert into public.audit_events
    (organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_organisation_id, p_actor_user_id, 'staff_invited',
          'organisation_membership', v_membership_id,
          jsonb_build_object('roles', p_roles, 'existing_user', v_user_confirmed));
  return v_membership_id;
end;
$$;

create or replace function public.activate_invited_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.organisation_memberships
    set status = 'active', activated_at = now(), updated_at = now()
    where user_id = new.id and status = 'invited';
    update public.broker_profiles bp set is_active = true, updated_at = now()
    where bp.user_id = new.id
      and exists (select 1 from public.organisation_memberships om
                  where om.organisation_id = bp.organisation_id and om.user_id = new.id
                    and om.status = 'active');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_staff_invite_activated on auth.users;
create trigger on_auth_staff_invite_activated
after update of email_confirmed_at on auth.users
for each row execute function public.activate_invited_staff();

create or replace function public.admin_set_staff_permissions(
  p_organisation_id uuid,
  p_user_id uuid,
  p_permissions public.staff_permission[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
  v_permission public.staff_permission;
begin
  if not private.has_staff_permission(p_organisation_id, 'manage_staff') then
    raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode = '42501';
  end if;
  select id into v_membership_id from public.organisation_memberships
  where organisation_id = p_organisation_id and user_id = p_user_id for update;
  if v_membership_id is null then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;

  delete from public.organisation_member_permissions where membership_id = v_membership_id;
  foreach v_permission in array coalesce(p_permissions, array[]::public.staff_permission[]) loop
    insert into public.organisation_member_permissions
      (membership_id, organisation_id, user_id, permission, granted_by_user_id)
    values (v_membership_id, p_organisation_id, p_user_id, v_permission, (select auth.uid()));
  end loop;
  insert into public.audit_events
    (organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_organisation_id, (select auth.uid()), 'staff_permissions_changed',
          'organisation_membership', v_membership_id,
          jsonb_build_object('permissions', coalesce(p_permissions, array[]::public.staff_permission[])));
end;
$$;

create or replace function public.admin_set_staff_status(
  p_organisation_id uuid,
  p_user_id uuid,
  p_status public.membership_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.organisation_memberships%rowtype;
  v_heads integer;
begin
  if not private.has_staff_permission(p_organisation_id, 'manage_staff') then
    raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode = '42501';
  end if;
  if p_status not in ('active','disabled') then
    raise exception 'STATUS_MUST_BE_ACTIVE_OR_DISABLED' using errcode = '22023';
  end if;
  perform 1 from public.organisations where id = p_organisation_id for update;
  select * into v_membership from public.organisation_memberships
  where organisation_id = p_organisation_id and user_id = p_user_id for update;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;

  if p_status = 'disabled' and v_membership.status = 'active'
     and exists (select 1 from public.organisation_member_roles
                 where membership_id = v_membership.id and role = 'head_broker') then
    select count(*) into v_heads
    from public.organisation_memberships om
    join public.organisation_member_roles mr on mr.membership_id = om.id
    where om.organisation_id = p_organisation_id and om.status = 'active'
      and mr.role = 'head_broker';
    if v_heads <= 1 then raise exception 'FINAL_HEAD_BROKER_REQUIRED' using errcode = '23514'; end if;
  end if;

  update public.organisation_memberships set
    status = p_status,
    activated_at = case when p_status = 'active' then coalesce(activated_at, now()) else activated_at end,
    disabled_at = case when p_status = 'disabled' then now() else null end,
    disabled_by_user_id = case when p_status = 'disabled' then (select auth.uid()) else null end,
    disabled_reason = case when p_status = 'disabled' then nullif(trim(p_reason), '') else null end,
    updated_at = now()
  where id = v_membership.id;
  update public.broker_profiles set is_active = (p_status = 'active'), updated_at = now()
  where organisation_id = p_organisation_id and user_id = p_user_id;

  insert into public.audit_events
    (organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_organisation_id, (select auth.uid()), 'staff_status_changed',
          'organisation_membership', v_membership.id,
          jsonb_build_object('from', v_membership.status, 'to', p_status, 'reason', p_reason));
end;
$$;

create or replace function public.admin_transfer_clients(
  p_organisation_id uuid,
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_client_ids uuid[] default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_count integer := 0;
  v_assignment record;
begin
  if not private.has_staff_permission(p_organisation_id, 'transfer_clients') then
    raise exception 'CLIENT_TRANSFER_NOT_AUTHORISED' using errcode = '42501';
  end if;
  if p_from_user_id = p_to_user_id then
    raise exception 'TRANSFER_USERS_MUST_DIFFER' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organisation_memberships om
    join public.organisation_member_roles mr on mr.membership_id = om.id
    where om.organisation_id = p_organisation_id and om.user_id = p_to_user_id
      and om.status = 'active' and mr.role in ('head_broker','broker')
  ) then raise exception 'TARGET_ACTIVE_BROKER_REQUIRED' using errcode = '23514'; end if;

  insert into public.client_transfer_batches
    (organisation_id, from_user_id, to_user_id, actor_user_id, reason)
  values (p_organisation_id, p_from_user_id, p_to_user_id, (select auth.uid()), nullif(trim(p_reason), ''))
  returning id into v_batch_id;

  for v_assignment in
    select ca.id, ca.client_id, ca.assignment_role
    from public.client_assignments ca
    where ca.organisation_id = p_organisation_id
      and ca.member_user_id = p_from_user_id
      and (p_client_ids is null or ca.client_id = any(p_client_ids))
    for update
  loop
    delete from public.client_assignments
    where organisation_id = p_organisation_id
      and client_id = v_assignment.client_id
      and member_user_id = p_to_user_id;
    update public.client_assignments
    set member_user_id = p_to_user_id
    where id = v_assignment.id;
    insert into public.client_transfer_items(batch_id, client_id, assignment_role)
    values (v_batch_id, v_assignment.client_id, v_assignment.assignment_role);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'NO_CLIENT_ASSIGNMENTS_FOUND' using errcode = 'P0002'; end if;
  update public.client_transfer_batches set client_count = v_count where id = v_batch_id;
  insert into public.audit_events
    (organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_organisation_id, (select auth.uid()), 'clients_transferred',
          'client_transfer_batch', v_batch_id,
          jsonb_build_object('from_user_id', p_from_user_id, 'to_user_id', p_to_user_id,
                             'client_count', v_count, 'reason', p_reason));
  return jsonb_build_object('batch_id', v_batch_id, 'client_count', v_count);
end;
$$;

create or replace function public.admin_update_company(
  p_organisation_id uuid,
  p_name text,
  p_legal_name text default null,
  p_abn text default null,
  p_billing_email text default null,
  p_contact_phone text default null,
  p_website text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_staff_permission(p_organisation_id, 'manage_company') then
    raise exception 'COMPANY_MANAGEMENT_NOT_AUTHORISED' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'COMPANY_NAME_REQUIRED' using errcode = '22023';
  end if;
  update public.organisations set
    name = trim(p_name), legal_name = nullif(trim(p_legal_name), ''), abn = nullif(trim(p_abn), ''),
    billing_email = nullif(trim(p_billing_email), ''), contact_phone = nullif(trim(p_contact_phone), ''),
    website = nullif(trim(p_website), ''), updated_at = now()
  where id = p_organisation_id;
  insert into public.audit_events
    (organisation_id, actor_user_id, event_type, entity_type, entity_id)
  values (p_organisation_id, (select auth.uid()), 'company_details_changed', 'organisation', p_organisation_id);
end;
$$;

-- Platform-admin suspension blocks every legacy status='active' check. Only
-- memberships disabled by this trigger are restored when the company reopens.
create or replace function private.sync_company_access_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('suspended','closed') and old.status is distinct from new.status then
    update public.organisation_memberships
    set status = 'disabled', disabled_at = now(), disabled_by_user_id = (select auth.uid()),
        disabled_reason = 'organisation_' || new.status::text, updated_at = now()
    where organisation_id = new.id and status = 'active';
    update public.broker_profiles set is_active = false, updated_at = now()
    where organisation_id = new.id and is_active;
  elsif new.status in ('trial','active') and old.status in ('suspended','closed') then
    update public.organisation_memberships
    set status = 'active', activated_at = coalesce(activated_at, now()), disabled_at = null,
        disabled_by_user_id = null, disabled_reason = null, updated_at = now()
    where organisation_id = new.id
      and status = 'disabled'
      and disabled_reason in ('organisation_suspended','organisation_closed');
    update public.broker_profiles bp set is_active = true, updated_at = now()
    where bp.organisation_id = new.id
      and exists (select 1 from public.organisation_memberships om
                  where om.organisation_id = bp.organisation_id and om.user_id = bp.user_id
                    and om.status = 'active');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_company_access_status on public.organisations;
create trigger trg_sync_company_access_status
after update of status on public.organisations
for each row execute function private.sync_company_access_status();

alter table public.organisation_member_roles enable row level security;
alter table public.organisation_member_permissions enable row level security;
alter table public.client_transfer_batches enable row level security;
alter table public.client_transfer_items enable row level security;

create policy member_roles_select_same_org on public.organisation_member_roles
for select to authenticated using ((select private.is_org_member(organisation_id)));
create policy member_permissions_select_managers on public.organisation_member_permissions
for select to authenticated using ((select private.has_staff_permission(organisation_id, 'manage_staff')));
create policy transfer_batches_select_managers on public.client_transfer_batches
for select to authenticated using ((select private.has_staff_permission(organisation_id, 'transfer_clients')));
create policy transfer_items_select_managers on public.client_transfer_items
for select to authenticated using (exists (
  select 1 from public.client_transfer_batches b
  where b.id = client_transfer_items.batch_id
    and private.has_staff_permission(b.organisation_id, 'transfer_clients')
));

-- All staff mutations go through audited RPCs. Existing Milestone 1 direct
-- membership policies are removed to close the final-admin bypass.
drop policy if exists memberships_insert_admin on public.organisation_memberships;
drop policy if exists memberships_update_admin on public.organisation_memberships;
drop policy if exists memberships_delete_admin on public.organisation_memberships;
revoke insert, update, delete on public.organisation_memberships from authenticated;
revoke update on public.organisations from authenticated;

revoke all on table public.organisation_member_roles from anon, authenticated;
revoke all on table public.organisation_member_permissions from anon, authenticated;
revoke all on table public.client_transfer_batches from anon, authenticated;
revoke all on table public.client_transfer_items from anon, authenticated;
grant select on public.organisation_member_roles to authenticated;
grant select on public.organisation_member_permissions to authenticated;
grant select on public.client_transfer_batches to authenticated;
grant select on public.client_transfer_items to authenticated;

revoke all on function private.has_staff_role(uuid, public.staff_role[]) from public, anon, authenticated;
revoke all on function private.has_staff_permission(uuid, public.staff_permission) from public, anon, authenticated;
revoke all on function private.legacy_role_for_staff(public.staff_role[]) from public, anon, authenticated;
revoke all on function private.actor_can_manage_staff(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.sync_company_access_status() from public, anon, authenticated;

revoke all on function public.admin_get_company_snapshot(uuid) from public, anon;
revoke all on function public.admin_set_staff_roles(uuid, uuid, public.staff_role[]) from public, anon;
revoke all on function public.admin_set_staff_permissions(uuid, uuid, public.staff_permission[]) from public, anon;
revoke all on function public.admin_set_staff_status(uuid, uuid, public.membership_status, text) from public, anon;
revoke all on function public.admin_transfer_clients(uuid, uuid, uuid, uuid[], text) from public, anon;
revoke all on function public.admin_update_company(uuid, text, text, text, text, text, text) from public, anon;

grant execute on function public.admin_get_company_snapshot(uuid) to authenticated;
grant execute on function public.admin_set_staff_roles(uuid, uuid, public.staff_role[]) to authenticated;
grant execute on function public.admin_set_staff_permissions(uuid, uuid, public.staff_permission[]) to authenticated;
grant execute on function public.admin_set_staff_status(uuid, uuid, public.membership_status, text) to authenticated;
grant execute on function public.admin_transfer_clients(uuid, uuid, uuid, uuid[], text) to authenticated;
grant execute on function public.admin_update_company(uuid, text, text, text, text, text, text) to authenticated;

revoke all on function public.service_find_user_by_email(text) from public, anon, authenticated;
revoke all on function public.service_add_invited_staff(uuid, uuid, uuid, public.staff_role[], text, text)
  from public, anon, authenticated;
revoke all on function public.activate_invited_staff() from public, anon, authenticated, service_role;
grant execute on function public.service_find_user_by_email(text) to service_role;
grant execute on function public.service_add_invited_staff(uuid, uuid, uuid, public.staff_role[], text, text)
  to service_role;

commit;
