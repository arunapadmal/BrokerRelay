begin;

-- Performance clean-up from Milestone 1 advisor findings.
drop index if exists public.uq_memberships_org_user;

create index if not exists idx_memberships_user
  on public.organisation_memberships(user_id);
create index if not exists idx_clients_created_by_user
  on public.clients(created_by_user_id)
  where created_by_user_id is not null;
create index if not exists idx_client_invitations_claimed_by
  on public.client_invitations(claimed_by_user_id)
  where claimed_by_user_id is not null;
create index if not exists idx_client_assignments_client_org
  on public.client_assignments(client_id, organisation_id);
create index if not exists idx_audit_events_actor
  on public.audit_events(actor_user_id)
  where actor_user_id is not null;

alter table public.client_invitations
  add column if not exists claimed_client_id uuid references public.clients(id) on delete set null;

create index if not exists idx_client_invitations_claimed_client
  on public.client_invitations(claimed_client_id)
  where claimed_client_id is not null;

-- Atomic invitation claim. This is intentionally callable only by service_role.
create or replace function public.claim_client_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_email text,
  p_first_name text,
  p_last_name text,
  p_mobile text default null
)
returns table (
  client_id uuid,
  organisation_id uuid,
  broker_user_id uuid,
  invitation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.client_invitations%rowtype;
  v_client_id uuid;
  v_existing_primary uuid;
begin
  if p_user_id is null then
    raise exception using errcode = 'P0001', message = 'AUTHENTICATED_USER_REQUIRED';
  end if;

  if coalesce(length(trim(p_first_name)), 0) = 0
     or coalesce(length(trim(p_last_name)), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'FIRST_AND_LAST_NAME_REQUIRED';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception using errcode = 'P0001', message = 'AUTH_USER_NOT_FOUND';
  end if;

  select *
    into v_inv
  from public.client_invitations ci
  where ci.token_hash = p_token_hash
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVALID_INVITATION';
  end if;

  if v_inv.status = 'revoked' then
    raise exception using errcode = 'P0001', message = 'INVITATION_REVOKED';
  end if;

  if v_inv.status = 'expired' or v_inv.expires_at <= now() then
    if v_inv.status <> 'expired' then
      update public.client_invitations
         set status = 'expired'
       where id = v_inv.id;
    end if;
    raise exception using errcode = 'P0001', message = 'INVITATION_EXPIRED';
  end if;

  -- Idempotent replay by the same authenticated user.
  if v_inv.status = 'claimed' then
    if v_inv.claimed_by_user_id = p_user_id and v_inv.claimed_client_id is not null then
      return query
      select v_inv.claimed_client_id, v_inv.organisation_id, v_inv.broker_user_id, v_inv.id;
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'INVITATION_ALREADY_CLAIMED';
  end if;

  -- Broker must still be an active member at claim time.
  if not exists (
    select 1
    from public.organisation_memberships om
    where om.organisation_id = v_inv.organisation_id
      and om.user_id = v_inv.broker_user_id
      and om.status = 'active'
      and om.role in ('company_admin', 'broker')
  ) then
    raise exception using errcode = 'P0001', message = 'BROKER_NOT_ACTIVE';
  end if;

  if not exists (
    select 1
    from public.broker_profiles bp
    where bp.organisation_id = v_inv.organisation_id
      and bp.user_id = v_inv.broker_user_id
      and bp.is_active = true
  ) then
    raise exception using errcode = 'P0001', message = 'BROKER_PROFILE_NOT_ACTIVE';
  end if;

  select c.id
    into v_client_id
  from public.clients c
  where c.organisation_id = v_inv.organisation_id
    and c.user_id = p_user_id
  limit 1;

  if v_client_id is null then
    insert into public.clients (
      organisation_id,
      user_id,
      first_name,
      last_name,
      email,
      mobile,
      status,
      created_by_user_id,
      connected_at
    ) values (
      v_inv.organisation_id,
      p_user_id,
      trim(p_first_name),
      trim(p_last_name),
      nullif(trim(p_email), ''),
      nullif(trim(p_mobile), ''),
      'active',
      p_user_id,
      now()
    )
    returning id into v_client_id;
  else
    update public.clients
       set first_name = trim(p_first_name),
           last_name = trim(p_last_name),
           email = coalesce(nullif(trim(p_email), ''), email),
           mobile = coalesce(nullif(trim(p_mobile), ''), mobile),
           status = 'active',
           connected_at = coalesce(connected_at, now())
     where id = v_client_id;
  end if;

  select ca.member_user_id
    into v_existing_primary
  from public.client_assignments ca
  where ca.client_id = v_client_id
    and ca.assignment_role = 'primary_broker'
  limit 1;

  if v_existing_primary is not null and v_existing_primary <> v_inv.broker_user_id then
    raise exception using errcode = 'P0001', message = 'CLIENT_ALREADY_ASSIGNED_TO_ANOTHER_PRIMARY_BROKER';
  end if;

  insert into public.client_assignments (
    organisation_id,
    client_id,
    member_user_id,
    assignment_role
  ) values (
    v_inv.organisation_id,
    v_client_id,
    v_inv.broker_user_id,
    'primary_broker'
  )
  on conflict (client_id, member_user_id)
  do update set assignment_role = 'primary_broker';

  update public.client_invitations
     set status = 'claimed',
         claimed_by_user_id = p_user_id,
         claimed_client_id = v_client_id,
         claimed_at = now()
   where id = v_inv.id;

  return query
  select v_client_id, v_inv.organisation_id, v_inv.broker_user_id, v_inv.id;
end;
$$;

revoke all on function public.claim_client_invitation(text, uuid, text, text, text, text) from public;
revoke all on function public.claim_client_invitation(text, uuid, text, text, text, text) from anon;
revoke all on function public.claim_client_invitation(text, uuid, text, text, text, text) from authenticated;
grant execute on function public.claim_client_invitation(text, uuid, text, text, text, text) to service_role;

-- Optimise direct auth.uid() checks in exposed RLS policies.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists platform_admins_select_self on public.platform_admins;
create policy platform_admins_select_self
on public.platform_admins
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists organisations_select_allowed on public.organisations;
create policy organisations_select_allowed
on public.organisations
for select
to authenticated
using (
  private.is_platform_admin()
  or private.is_org_member(id)
  or exists (
    select 1
    from public.clients c
    where c.organisation_id = organisations.id
      and c.user_id = (select auth.uid())
  )
);

drop policy if exists memberships_select_allowed on public.organisation_memberships;
create policy memberships_select_allowed
on public.organisation_memberships
for select
to authenticated
using (
  private.is_platform_admin()
  or user_id = (select auth.uid())
  or private.is_org_member(organisation_id)
);

drop policy if exists invitations_select_staff on public.client_invitations;
create policy invitations_select_staff
on public.client_invitations
for select
to authenticated
using (
  private.is_platform_admin()
  or broker_user_id = (select auth.uid())
  or private.has_org_role(
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
  private.is_platform_admin()
  or (
    broker_user_id = (select auth.uid())
    and private.has_org_role(
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
  private.is_platform_admin()
  or broker_user_id = (select auth.uid())
  or private.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
)
with check (
  private.is_platform_admin()
  or broker_user_id = (select auth.uid())
  or private.has_org_role(
    organisation_id,
    array['company_admin']::public.membership_role[]
  )
);

commit;;
