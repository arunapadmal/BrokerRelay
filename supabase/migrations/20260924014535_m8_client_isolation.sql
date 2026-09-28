begin;

-- M8: assignment-only client access and explicit delegated servicing.
-- Administrative roles may manage assignments, but never gain client-content access implicitly.

create or replace function private.can_staff_access_client(p_organisation_id uuid, p_client_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from public.client_assignments ca
    join public.organisation_memberships om
      on om.organisation_id=ca.organisation_id
     and om.user_id=ca.member_user_id
     and om.status='active'
     and om.removed_at is null
    where ca.organisation_id=p_organisation_id
      and ca.client_id=p_client_id
      and ca.member_user_id=(select auth.uid())
  );
$$;

create or replace function private.can_access_client(p_organisation_id uuid, p_client_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_client_owner(p_organisation_id,p_client_id)
      or private.can_staff_access_client(p_organisation_id,p_client_id);
$$;

create or replace function private.can_access_conversation(p_organisation_id uuid,p_conversation_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.conversations conv
    where conv.id=p_conversation_id
      and conv.organisation_id=p_organisation_id
      and private.can_access_client(conv.organisation_id,conv.client_id)
  );
$$;

create or replace function private.can_message_client(p_organisation_id uuid,p_client_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.clients c
    where c.id=p_client_id and c.organisation_id=p_organisation_id
      and c.connected_at is not null and c.status<>'archived'
      and private.can_access_client(c.organisation_id,c.id)
  );
$$;

create or replace function private.can_view_loan_application(p_organisation_id uuid,p_client_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_access_client(p_organisation_id,p_client_id);
$$;

create or replace function private.can_manage_loan_application(p_organisation_id uuid,p_client_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.clients c
    where c.id=p_client_id and c.organisation_id=p_organisation_id
      and c.connected_at is not null and c.status<>'archived'
      and private.can_staff_access_client(c.organisation_id,c.id)
  );
$$;

-- Assignment metadata is visible only to the client, assigned service team, or Head Broker.
drop policy if exists assignments_select_allowed on public.client_assignments;
create policy assignments_select_allowed on public.client_assignments for select to authenticated
using (
  private.is_client_owner(organisation_id,client_id)
  or private.is_assigned_staff(organisation_id,client_id)
  or private.is_head_broker(organisation_id,(select auth.uid()))
);

-- Direct writes are removed; audited RPCs below are the only assignment mutation path.
drop policy if exists assignments_insert_admin on public.client_assignments;
drop policy if exists assignments_update_admin on public.client_assignments;
drop policy if exists assignments_delete_admin on public.client_assignments;
revoke insert,update,delete on public.client_assignments from authenticated;

-- Head Brokers can see delivery endpoint configuration, but not client requests/content unless assigned.
drop policy if exists document_delivery_endpoints_select_own on public.document_delivery_endpoints;
create policy document_delivery_endpoints_select_own on public.document_delivery_endpoints for select to authenticated
using (user_id=(select auth.uid()) or private.is_head_broker(organisation_id,(select auth.uid())));

-- Application numbers are business keys across the entire platform, not merely one company.
do $$ begin
  if exists (
    select 1 from public.loan_applications
    where application_reference is not null
    group by lower(btrim(application_reference)) having count(*)>1
  ) then
    raise exception 'M8_DUPLICATE_APPLICATION_NUMBERS_REQUIRE_REPAIR';
  end if;
end $$;
drop index if exists public.loan_applications_reference_unique_per_org;
create unique index if not exists loan_applications_reference_unique_global
  on public.loan_applications(lower(btrim(application_reference)))
  where application_reference is not null;

create or replace function public.get_client_service_team(p_client_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_org uuid; v_allowed boolean; v_manage_primary boolean; v_manage_assistants boolean;
begin
  select c.organisation_id into v_org from public.clients c where c.id=p_client_id;
  if v_org is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  v_manage_primary:=private.is_head_broker(v_org,(select auth.uid()));
  v_manage_assistants:=v_manage_primary or exists(
    select 1 from public.client_assignments ca where ca.client_id=p_client_id
      and ca.organisation_id=v_org and ca.member_user_id=(select auth.uid())
      and ca.assignment_role='primary_broker'
  );
  v_allowed:=private.can_access_client(v_org,p_client_id) or v_manage_primary;
  if not v_allowed then raise exception 'CLIENT_ACCESS_NOT_AUTHORISED' using errcode='42501'; end if;
  return jsonb_build_object(
    'organisation_id',v_org,
    'can_manage_primary',v_manage_primary,
    'can_manage_assistants',v_manage_assistants,
    'assignments',coalesce((select jsonb_agg(jsonb_build_object(
      'user_id',ca.member_user_id,'assignment_role',ca.assignment_role,
      'first_name',p.first_name,'last_name',p.last_name,'email',u.email
    ) order by case ca.assignment_role when 'primary_broker' then 0 else 1 end,p.first_name,p.last_name)
      from public.client_assignments ca left join public.profiles p on p.id=ca.member_user_id
      left join auth.users u on u.id=ca.member_user_id where ca.client_id=p_client_id and ca.organisation_id=v_org),'[]'::jsonb),
    'eligible_brokers',coalesce((select jsonb_agg(jsonb_build_object('user_id',om.user_id,'first_name',p.first_name,'last_name',p.last_name,'email',u.email) order by p.first_name,p.last_name)
      from public.organisation_memberships om left join public.profiles p on p.id=om.user_id left join auth.users u on u.id=om.user_id
      where om.organisation_id=v_org and om.status='active' and om.removed_at is null
        and exists(select 1 from public.organisation_member_roles mr where mr.membership_id=om.id and mr.role in ('head_broker','broker'))),'[]'::jsonb),
    'eligible_assistants',coalesce((select jsonb_agg(jsonb_build_object('user_id',om.user_id,'first_name',p.first_name,'last_name',p.last_name,'email',u.email) order by p.first_name,p.last_name)
      from public.organisation_memberships om left join public.profiles p on p.id=om.user_id left join auth.users u on u.id=om.user_id
      where om.organisation_id=v_org and om.status='active' and om.removed_at is null
        and exists(select 1 from public.organisation_member_roles mr where mr.membership_id=om.id and mr.role='broker_assistant')),'[]'::jsonb)
  );
end $$;

create or replace function public.set_client_primary_broker(p_client_id uuid,p_broker_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_old uuid;
begin
  select organisation_id into v_org from public.clients where id=p_client_id for update;
  if v_org is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  if not private.is_head_broker(v_org,(select auth.uid())) then raise exception 'HEAD_BROKER_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from public.organisation_memberships om where om.organisation_id=v_org and om.user_id=p_broker_user_id and om.status='active' and om.removed_at is null
    and exists(select 1 from public.organisation_member_roles mr where mr.membership_id=om.id and mr.role in ('head_broker','broker'))) then
    raise exception 'ACTIVE_SAME_COMPANY_BROKER_REQUIRED' using errcode='23514';
  end if;
  select member_user_id into v_old from public.client_assignments where client_id=p_client_id and assignment_role='primary_broker' for update;
  delete from public.client_assignments where client_id=p_client_id and assignment_role='primary_broker';
  insert into public.client_assignments(organisation_id,client_id,member_user_id,assignment_role)
  values(v_org,p_client_id,p_broker_user_id,'primary_broker')
  on conflict(client_id,member_user_id) do update set assignment_role='primary_broker';
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(v_org,(select auth.uid()),'client_primary_broker_changed','client',p_client_id,jsonb_build_object('from_user_id',v_old,'to_user_id',p_broker_user_id));
end $$;

create or replace function public.set_client_assistant(p_client_id uuid,p_assistant_user_id uuid,p_assigned boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_can_manage boolean;
begin
  select organisation_id into v_org from public.clients where id=p_client_id for update;
  if v_org is null then raise exception 'CLIENT_NOT_FOUND' using errcode='P0002'; end if;
  v_can_manage:=private.is_head_broker(v_org,(select auth.uid())) or exists(select 1 from public.client_assignments ca
    where ca.client_id=p_client_id and ca.member_user_id=(select auth.uid()) and ca.assignment_role='primary_broker');
  if not v_can_manage then raise exception 'CLIENT_TEAM_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  if not exists(select 1 from public.organisation_memberships om where om.organisation_id=v_org and om.user_id=p_assistant_user_id and om.status='active' and om.removed_at is null
    and exists(select 1 from public.organisation_member_roles mr where mr.membership_id=om.id and mr.role='broker_assistant')) then
    raise exception 'ACTIVE_SAME_COMPANY_BROKER_ASSISTANT_REQUIRED' using errcode='23514';
  end if;
  if p_assigned then
    insert into public.client_assignments(organisation_id,client_id,member_user_id,assignment_role)
    values(v_org,p_client_id,p_assistant_user_id,'assistant')
    on conflict(client_id,member_user_id) do update set assignment_role='assistant';
  else
    delete from public.client_assignments where client_id=p_client_id and member_user_id=p_assistant_user_id and assignment_role='assistant';
  end if;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(v_org,(select auth.uid()),case when p_assigned then 'client_assistant_assigned' else 'client_assistant_removed' end,
    'client',p_client_id,jsonb_build_object('assistant_user_id',p_assistant_user_id));
end $$;

revoke all on function public.get_client_service_team(uuid) from public,anon;
revoke all on function public.set_client_primary_broker(uuid,uuid) from public,anon;
revoke all on function public.set_client_assistant(uuid,uuid,boolean) from public,anon;
grant execute on function public.get_client_service_team(uuid) to authenticated;
grant execute on function public.set_client_primary_broker(uuid,uuid) to authenticated;
grant execute on function public.set_client_assistant(uuid,uuid,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
