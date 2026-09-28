begin;

-- Tenant permissions are earned through active membership, never platform status.
create or replace function private.is_org_member(p_organisation_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.organisation_memberships om
    join public.organisations o on o.id=om.organisation_id
    where om.organisation_id=p_organisation_id and om.user_id=(select auth.uid())
      and om.status='active' and om.removed_at is null and o.status in ('trial','active')
  );
$$;

create or replace function private.has_staff_role(p_organisation_id uuid,p_roles public.staff_role[])
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.organisation_memberships om
    join public.organisation_member_roles mr on mr.membership_id=om.id
    join public.organisations o on o.id=om.organisation_id
    where om.organisation_id=p_organisation_id and om.user_id=(select auth.uid())
      and om.status='active' and om.removed_at is null and o.status in ('trial','active')
      and mr.role=any(p_roles)
  );
$$;

create or replace function private.has_org_role(p_organisation_id uuid,p_roles public.membership_role[])
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.organisation_memberships om
    join public.organisations o on o.id=om.organisation_id
    where om.organisation_id=p_organisation_id and om.user_id=(select auth.uid())
      and om.status='active' and om.removed_at is null and o.status in ('trial','active')
      and (om.role=any(p_roles)
        or ('company_admin'::public.membership_role=any(p_roles)
          and private.has_staff_permission(p_organisation_id,'manage_staff'))
        or ('broker'::public.membership_role=any(p_roles)
          and private.has_staff_role(p_organisation_id,array['head_broker','broker']::public.staff_role[]))
        or ('broker_assistant'::public.membership_role=any(p_roles)
          and private.has_staff_role(p_organisation_id,array['broker_assistant']::public.staff_role[])))
  );
$$;

create or replace function private.has_staff_permission(p_organisation_id uuid,p_permission public.staff_permission)
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_head_broker(p_organisation_id,(select auth.uid()))
    or (p_permission<>'manage_company' and (
      (p_permission in ('manage_staff','transfer_clients','manage_announcements')
       and private.has_staff_role(p_organisation_id,array['administrator']::public.staff_role[]))
      or (p_permission in ('view_finance','manage_finance')
          and private.has_staff_role(p_organisation_id,array['accounts']::public.staff_role[]))
      or (p_permission='manage_hr'
          and private.has_staff_role(p_organisation_id,array['hr']::public.staff_role[]))
      or exists(
        select 1 from public.organisation_memberships om
        join public.organisation_member_permissions mp on mp.membership_id=om.id
        join public.organisations o on o.id=om.organisation_id
        where om.organisation_id=p_organisation_id and om.user_id=(select auth.uid())
          and om.status='active' and om.removed_at is null and o.status in ('trial','active')
          and mp.permission=p_permission and mp.permission<>'manage_company'
      )
    ));
$$;

create or replace function private.can_view_broker_profile(p_organisation_id uuid,p_broker_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_org_member(p_organisation_id)
    or exists (
      select 1 from public.clients c
      join public.client_assignments ca on ca.client_id=c.id and ca.organisation_id=c.organisation_id
      where c.user_id=(select auth.uid()) and c.organisation_id=p_organisation_id
        and ca.member_user_id=p_broker_user_id
    );
$$;

create or replace function private.can_view_profile(p_target_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid())=p_target_user_id
    or exists (
      select 1 from public.organisation_memberships mine
      join public.organisation_memberships theirs on theirs.organisation_id=mine.organisation_id
      where mine.user_id=(select auth.uid()) and mine.status='active' and mine.removed_at is null
        and theirs.user_id=p_target_user_id and theirs.status='active' and theirs.removed_at is null
    )
    or exists (
      select 1 from public.clients c
      join public.client_assignments ca on ca.client_id=c.id and ca.organisation_id=c.organisation_id
      where c.user_id=(select auth.uid()) and ca.member_user_id=p_target_user_id
    );
$$;

drop policy if exists audit_select_allowed on public.audit_events;
create policy audit_select_allowed on public.audit_events for select to authenticated
using (organisation_id is not null and
  private.has_org_role(organisation_id,array['company_admin'::public.membership_role]));

-- Company provisioning is a platform operation, never a direct table insert.
drop policy if exists organisations_insert_platform_admin on public.organisations;
revoke insert on public.organisations from authenticated;

-- A platform administrator does not gain operational access to another tenant.
drop policy if exists broker_profiles_insert_admin on public.broker_profiles;
create policy broker_profiles_insert_admin on public.broker_profiles for insert to authenticated
with check (private.has_org_role(organisation_id,array['company_admin'::public.membership_role]));
drop policy if exists broker_profiles_update_admin on public.broker_profiles;
create policy broker_profiles_update_admin on public.broker_profiles for update to authenticated
using (private.has_org_role(organisation_id,array['company_admin'::public.membership_role]))
with check (private.has_org_role(organisation_id,array['company_admin'::public.membership_role]));
drop policy if exists broker_profiles_delete_admin on public.broker_profiles;
create policy broker_profiles_delete_admin on public.broker_profiles for delete to authenticated
using (private.has_org_role(organisation_id,array['company_admin'::public.membership_role]));

drop policy if exists invitations_insert_staff on public.client_invitations;
create policy invitations_insert_staff on public.client_invitations for insert to authenticated
with check (broker_user_id=(select auth.uid()) and
  private.has_org_role(organisation_id,array['company_admin'::public.membership_role,'broker'::public.membership_role]));
drop policy if exists invitations_select_staff on public.client_invitations;
create policy invitations_select_staff on public.client_invitations for select to authenticated
using ((broker_user_id=(select auth.uid()) and private.is_org_member(organisation_id))
  or private.has_org_role(organisation_id,array['company_admin'::public.membership_role]));
drop policy if exists invitations_update_staff on public.client_invitations;
create policy invitations_update_staff on public.client_invitations for update to authenticated
using ((broker_user_id=(select auth.uid()) and private.is_org_member(organisation_id))
  or private.has_org_role(organisation_id,array['company_admin'::public.membership_role]))
with check ((broker_user_id=(select auth.uid()) and private.is_org_member(organisation_id))
  or private.has_org_role(organisation_id,array['company_admin'::public.membership_role]));

drop policy if exists clients_insert_staff on public.clients;
create policy clients_insert_staff on public.clients for insert to authenticated
with check (private.has_org_role(organisation_id,array['company_admin'::public.membership_role,'broker'::public.membership_role]));

drop policy if exists memberships_select_allowed on public.organisation_memberships;
create policy memberships_select_allowed on public.organisation_memberships for select to authenticated
using (user_id=(select auth.uid()) or private.is_org_member(organisation_id));

-- Reuse the same legal-identity and Head Broker setup as the initial-company flow.
-- The nominated person must already have a verified account but no staff membership.
create or replace function public.platform_create_company(
  p_name text, p_legal_name text, p_abn text, p_billing_email text,
  p_head_broker_email text, p_contact_phone text default null,
  p_website text default null, p_broker_code text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := (select auth.uid());
  v_head uuid;
  v_org uuid;
  v_membership uuid;
  v_abn text := regexp_replace(coalesce(p_abn,''),'[^0-9]','','g');
  v_email text := lower(btrim(coalesce(p_head_broker_email,'')));
  v_phone text := nullif(btrim(p_contact_phone),'');
  v_website text := nullif(btrim(p_website),'');
begin
  if v_owner is null or not private.is_platform_admin()
     or not exists(select 1 from auth.users u where u.id=v_owner and lower(u.email)='aruna@aidez.com.au') then
    raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';
  end if;
  if nullif(btrim(p_name),'') is null or length(btrim(p_name))>160 then
    raise exception 'INVALID_COMPANY_NAME' using errcode='22023'; end if;
  if nullif(btrim(p_legal_name),'') is null or length(btrim(p_legal_name))>200 then
    raise exception 'INVALID_LEGAL_NAME' using errcode='22023'; end if;
  if length(v_abn)<>11 or not private.valid_abn(v_abn) then
    raise exception 'INVALID_ABN' using errcode='22023'; end if;
  if nullif(btrim(p_billing_email),'') is null or btrim(p_billing_email)!~*'^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'INVALID_BILLING_EMAIL' using errcode='22023'; end if;
  if v_phone is not null and (v_phone!~'^[+()0-9[:space:]\-]+$'
    or not ((length(regexp_replace(v_phone,'[^0-9]','','g'))=10 and regexp_replace(v_phone,'[^0-9]','','g') like '0%')
      or (length(regexp_replace(v_phone,'[^0-9]','','g'))=11 and regexp_replace(v_phone,'[^0-9]','','g') like '61%'))) then
    raise exception 'INVALID_PHONE' using errcode='22023'; end if;
  if v_website is not null and v_website!~*'^https?://[^[:space:]]+$' then
    raise exception 'INVALID_WEBSITE' using errcode='22023'; end if;
  if v_email='' then raise exception 'HEAD_BROKER_ACCOUNT_REQUIRED' using errcode='22023'; end if;

  select u.id into v_head from auth.users u
  where lower(u.email)=v_email and u.email_confirmed_at is not null;
  if v_head is null or v_head=v_owner or exists(
    select 1 from public.organisation_memberships om where om.user_id=v_head
  ) or exists(select 1 from public.platform_admins pa where pa.user_id=v_head) then
    raise exception 'ELIGIBLE_VERIFIED_HEAD_BROKER_ACCOUNT_REQUIRED' using errcode='23514';
  end if;

  insert into public.organisations(
    name,legal_name,abn,billing_email,contact_phone,website,status,
    head_broker_user_id,identity_locked,identity_verified_at,identity_verified_by
  ) values (
    btrim(p_name),btrim(p_legal_name),v_abn,lower(btrim(p_billing_email)),v_phone,v_website,'active',
    v_head,true,now(),v_owner
  ) returning id into v_org;

  insert into public.organisation_memberships(
    organisation_id,user_id,role,status,invited_at,activated_at
  ) values (v_org,v_head,'company_admin','active',now(),now())
  returning id into v_membership;

  perform set_config('brokerrelay.head_broker_transfer',v_org::text,true);
  insert into public.organisation_member_roles(
    membership_id,organisation_id,user_id,role,granted_by_user_id
  ) values (v_membership,v_org,v_head,'head_broker',v_owner);
  perform set_config('brokerrelay.head_broker_transfer','',true);

  insert into public.broker_profiles(organisation_id,user_id,broker_code,title,is_active)
  values (v_org,v_head,coalesce(nullif(btrim(p_broker_code),''),
    'BR-'||upper(substr(replace(v_head::text,'-',''),1,8))),'Head Broker',true);

  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values (v_org,v_owner,'company_created','organisation',v_org,
    jsonb_build_object('head_broker_user_id',v_head));
  return v_org;
end $$;

revoke all on function public.platform_create_company(text,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.platform_create_company(text,text,text,text,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
