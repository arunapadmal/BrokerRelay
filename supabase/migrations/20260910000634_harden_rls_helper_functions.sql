begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid()
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
    select 1 from public.organisation_memberships om
    where om.organisation_id = p_organisation_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  );
$$;

create or replace function private.has_org_role(p_organisation_id uuid, p_roles public.membership_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organisation_memberships om
    where om.organisation_id = p_organisation_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role = any(p_roles)
  );
$$;

create or replace function private.is_client_owner(p_organisation_id uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clients c
    where c.id = p_client_id
      and c.organisation_id = p_organisation_id
      and c.user_id = auth.uid()
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
      on om.organisation_id = ca.organisation_id
     and om.user_id = ca.member_user_id
    where ca.organisation_id = p_organisation_id
      and ca.client_id = p_client_id
      and ca.member_user_id = auth.uid()
      and om.status = 'active'
  );
$$;

create or replace function private.can_staff_access_client(p_organisation_id uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
      or private.has_org_role(p_organisation_id, array['company_admin']::public.membership_role[])
      or private.is_assigned_staff(p_organisation_id, p_client_id);
$$;

create or replace function private.can_access_client(p_organisation_id uuid, p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_staff_access_client(p_organisation_id, p_client_id)
      or private.is_client_owner(p_organisation_id, p_client_id);
$$;

create or replace function private.can_view_profile(p_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() = p_target_user_id
    or private.is_platform_admin()
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

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

-- Rebuild policies to use non-exposed private helper functions.
drop policy if exists profiles_select_allowed on public.profiles;
create policy profiles_select_allowed on public.profiles for select to authenticated
using (private.can_view_profile(id));

drop policy if exists organisations_select_allowed on public.organisations;
create policy organisations_select_allowed on public.organisations for select to authenticated
using (
  private.is_platform_admin()
  or private.is_org_member(id)
  or exists (
    select 1 from public.clients c
    where c.organisation_id = organisations.id
      and c.user_id = auth.uid()
  )
);

drop policy if exists organisations_insert_platform_admin on public.organisations;
create policy organisations_insert_platform_admin on public.organisations for insert to authenticated
with check (private.is_platform_admin());

drop policy if exists organisations_update_allowed on public.organisations;
create policy organisations_update_allowed on public.organisations for update to authenticated
using (private.is_platform_admin() or private.has_org_role(id, array['company_admin']::public.membership_role[]))
with check (private.is_platform_admin() or private.has_org_role(id, array['company_admin']::public.membership_role[]));

drop policy if exists memberships_select_allowed on public.organisation_memberships;
create policy memberships_select_allowed on public.organisation_memberships for select to authenticated
using (private.is_platform_admin() or user_id = auth.uid() or private.is_org_member(organisation_id));

drop policy if exists memberships_insert_admin on public.organisation_memberships;
create policy memberships_insert_admin on public.organisation_memberships for insert to authenticated
with check (private.is_platform_admin() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]));

drop policy if exists memberships_update_admin on public.organisation_memberships;
create policy memberships_update_admin on public.organisation_memberships for update to authenticated
using (private.is_platform_admin() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]))
with check (private.is_platform_admin() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]));

drop policy if exists memberships_delete_admin on public.organisation_memberships;
create policy memberships_delete_admin on public.organisation_memberships for delete to authenticated
using (private.is_platform_admin() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]));

drop policy if exists clients_select_allowed on public.clients;
create policy clients_select_allowed on public.clients for select to authenticated
using (private.can_access_client(organisation_id, id));

drop policy if exists clients_insert_staff on public.clients;
create policy clients_insert_staff on public.clients for insert to authenticated
with check (private.is_platform_admin() or private.has_org_role(organisation_id, array['company_admin','broker']::public.membership_role[]));

drop policy if exists clients_update_staff on public.clients;
create policy clients_update_staff on public.clients for update to authenticated
using (private.can_staff_access_client(organisation_id, id))
with check (private.can_staff_access_client(organisation_id, id));

drop policy if exists assignments_select_allowed on public.client_assignments;
create policy assignments_select_allowed on public.client_assignments for select to authenticated
using (private.is_platform_admin() or private.is_org_member(organisation_id) or private.is_client_owner(organisation_id, client_id));

drop policy if exists assignments_insert_admin on public.client_assignments;
create policy assignments_insert_admin on public.client_assignments for insert to authenticated
with check (private.is_platform_admin() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]));

drop policy if exists assignments_update_admin on public.client_assignments;
create policy assignments_update_admin on public.client_assignments for update to authenticated
using (private.is_platform_admin() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]))
with check (private.is_platform_admin() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]));

drop policy if exists assignments_delete_admin on public.client_assignments;
create policy assignments_delete_admin on public.client_assignments for delete to authenticated
using (private.is_platform_admin() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]));

drop policy if exists invitations_select_staff on public.client_invitations;
create policy invitations_select_staff on public.client_invitations for select to authenticated
using (private.is_platform_admin() or broker_user_id = auth.uid() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]));

drop policy if exists invitations_insert_staff on public.client_invitations;
create policy invitations_insert_staff on public.client_invitations for insert to authenticated
with check (
  private.is_platform_admin()
  or (broker_user_id = auth.uid() and private.has_org_role(organisation_id, array['company_admin','broker']::public.membership_role[]))
);

drop policy if exists invitations_update_staff on public.client_invitations;
create policy invitations_update_staff on public.client_invitations for update to authenticated
using (private.is_platform_admin() or broker_user_id = auth.uid() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]))
with check (private.is_platform_admin() or broker_user_id = auth.uid() or private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]));

drop policy if exists audit_select_allowed on public.audit_events;
create policy audit_select_allowed on public.audit_events for select to authenticated
using (
  private.is_platform_admin()
  or (organisation_id is not null and private.has_org_role(organisation_id, array['company_admin']::public.membership_role[]))
);

-- Old public helper RPCs are no longer needed. Remove execute access first.
revoke all on function public.is_platform_admin() from public, anon, authenticated;
revoke all on function public.is_org_member(uuid) from public, anon, authenticated;
revoke all on function public.has_org_role(uuid, public.membership_role[]) from public, anon, authenticated;
revoke all on function public.is_client_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_assigned_staff(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_staff_access_client(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_access_client(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_view_profile(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Keep trigger function in public but make it non-callable through API roles.
-- Drop obsolete public helper functions now that policies use private versions.
drop function if exists public.can_access_client(uuid, uuid);
drop function if exists public.can_staff_access_client(uuid, uuid);
drop function if exists public.can_view_profile(uuid);
drop function if exists public.has_org_role(uuid, public.membership_role[]);
drop function if exists public.is_assigned_staff(uuid, uuid);
drop function if exists public.is_client_owner(uuid, uuid);
drop function if exists public.is_org_member(uuid);
drop function if exists public.is_platform_admin();

commit;;
