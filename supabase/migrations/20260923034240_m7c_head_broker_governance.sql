begin;

-- Milestone 7C: protected, single-owner Head Broker governance.
-- Forward-only: no applied migration is modified.

alter table public.organisations
  add column if not exists head_broker_user_id uuid references auth.users(id) on delete restrict;

-- Choose one deterministic owner for each existing organisation.
with ranked as (
  select om.organisation_id, om.user_id,
    row_number() over (
      partition by om.organisation_id
      order by
        case
          when exists (select 1 from public.organisation_member_roles mr where mr.membership_id=om.id and mr.role='head_broker') then 0
          when om.role='company_admin' then 1
          when exists (select 1 from public.organisation_member_roles mr where mr.membership_id=om.id and mr.role='administrator') then 2
          else 3
        end,
        om.created_at, om.id
    ) as position
  from public.organisation_memberships om
  where om.status='active' and om.removed_at is null
), selected as (
  select organisation_id,user_id from ranked where position=1
)
update public.organisations o
set head_broker_user_id=s.user_id, updated_at=now()
from selected s
where s.organisation_id=o.id and o.head_broker_user_id is null;

do $$ begin
  if exists(select 1 from public.organisations where head_broker_user_id is null) then
    raise exception 'HEAD_BROKER_BACKFILL_REQUIRES_AN_ACTIVE_STAFF_MEMBER';
  end if;
end $$;

delete from public.organisation_member_roles mr
using public.organisations o
where mr.organisation_id=o.id and mr.role='head_broker' and mr.user_id<>o.head_broker_user_id;

insert into public.organisation_member_roles
  (membership_id,organisation_id,user_id,role,granted_by_user_id)
select om.id,om.organisation_id,om.user_id,'head_broker'::public.staff_role,null
from public.organisation_memberships om
join public.organisations o on o.id=om.organisation_id and o.head_broker_user_id=om.user_id
where not exists(select 1 from public.organisation_member_roles mr where mr.membership_id=om.id and mr.role='head_broker');

create unique index if not exists organisation_one_head_broker
  on public.organisation_member_roles(organisation_id) where role='head_broker';

alter table public.organisations alter column head_broker_user_id set not null;

-- Ownership is inherent and cannot be delegated as an ordinary permission.
delete from public.organisation_member_permissions where permission='manage_company';

create or replace function private.is_head_broker(p_organisation_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.organisations o
    join public.organisation_memberships om
      on om.organisation_id=o.id and om.user_id=o.head_broker_user_id
    where o.id=p_organisation_id and o.head_broker_user_id=p_user_id
      and o.status in ('trial','active') and om.status='active' and om.removed_at is null
  );
$$;

create or replace function private.has_staff_permission(
  p_organisation_id uuid,p_permission public.staff_permission
) returns boolean language sql stable security definer set search_path='' as $$
  select private.is_platform_admin()
    or private.is_head_broker(p_organisation_id,(select auth.uid()))
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

create or replace function private.actor_can_manage_staff(p_actor_user_id uuid,p_organisation_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.platform_admins pa where pa.user_id=p_actor_user_id)
    or private.is_head_broker(p_organisation_id,p_actor_user_id)
    or exists(
      select 1 from public.organisation_memberships om
      join public.organisations o on o.id=om.organisation_id
      where om.organisation_id=p_organisation_id and om.user_id=p_actor_user_id
        and om.status='active' and om.removed_at is null and o.status in ('trial','active')
        and (
          exists(select 1 from public.organisation_member_roles mr where mr.membership_id=om.id and mr.role='administrator')
          or exists(select 1 from public.organisation_member_permissions mp where mp.membership_id=om.id and mp.permission='manage_staff')
        )
    );
$$;

create or replace function private.guard_head_broker_role()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_org uuid;
  v_touches_head boolean:=false;
begin
  if tg_op='INSERT' then
    v_org:=new.organisation_id;
    v_touches_head:=new.role='head_broker';
  elsif tg_op='DELETE' then
    v_org:=old.organisation_id;
    v_touches_head:=old.role='head_broker';
  else
    v_org:=new.organisation_id;
    v_touches_head:=old.role='head_broker' or new.role='head_broker';
  end if;
  if v_touches_head
     and coalesce(current_setting('brokerrelay.head_broker_transfer',true),'')<>v_org::text then
    raise exception 'HEAD_BROKER_CHANGES_REQUIRE_OWNERSHIP_TRANSFER' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;

drop trigger if exists guard_head_broker_role on public.organisation_member_roles;
create trigger guard_head_broker_role before insert or update or delete
on public.organisation_member_roles for each row execute function private.guard_head_broker_role();

create or replace function private.guard_head_broker_membership()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.organisations o where o.id=old.organisation_id and o.head_broker_user_id=old.user_id)
     and (new.organisation_id is distinct from old.organisation_id
          or new.user_id is distinct from old.user_id
          or new.status<>'active' or new.removed_at is not null) then
    raise exception 'HEAD_BROKER_MUST_TRANSFER_OWNERSHIP_FIRST' using errcode='23514';
  end if;
  return new;
end; $$;

drop trigger if exists guard_head_broker_membership on public.organisation_memberships;
create trigger guard_head_broker_membership before update on public.organisation_memberships
for each row execute function private.guard_head_broker_membership();

create or replace function public.admin_update_company(
  p_organisation_id uuid,p_name text,p_legal_name text default null,p_abn text default null,
  p_billing_email text default null,p_contact_phone text default null,p_website text default null
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_abn text:=nullif(regexp_replace(coalesce(p_abn,''),'[^0-9]','','g'),'');
  v_phone text:=nullif(trim(p_contact_phone),'');
  v_website text:=nullif(trim(p_website),'');
begin
  if not private.is_platform_admin() and not private.is_head_broker(p_organisation_id,(select auth.uid())) then
    raise exception 'HEAD_BROKER_REQUIRED_FOR_COMPANY_MANAGEMENT' using errcode='42501';
  end if;
  if nullif(trim(p_name),'') is null or length(trim(p_name))>160 then raise exception 'INVALID_COMPANY_NAME' using errcode='22023'; end if;
  if p_legal_name is not null and length(trim(p_legal_name))>200 then raise exception 'INVALID_LEGAL_NAME' using errcode='22023'; end if;
  if not private.valid_abn(v_abn) then raise exception 'INVALID_ABN' using errcode='22023'; end if;
  if nullif(trim(p_billing_email),'') is not null and trim(p_billing_email)!~*'^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'INVALID_BILLING_EMAIL' using errcode='22023';
  end if;
  if v_phone is not null and (v_phone!~'^[+()0-9[:space:]\-]+$'
     or not ((length(regexp_replace(v_phone,'[^0-9]','','g'))=10 and regexp_replace(v_phone,'[^0-9]','','g') like '0%')
          or (length(regexp_replace(v_phone,'[^0-9]','','g'))=11 and regexp_replace(v_phone,'[^0-9]','','g') like '61%'))) then
    raise exception 'INVALID_PHONE' using errcode='22023';
  end if;
  if v_website is not null and v_website!~*'^https?://[^[:space:]]+$' then raise exception 'INVALID_WEBSITE' using errcode='22023'; end if;
  update public.organisations set name=trim(p_name),legal_name=nullif(trim(p_legal_name),''),abn=v_abn,
    billing_email=nullif(lower(trim(p_billing_email)),''),contact_phone=v_phone,website=v_website,updated_at=now()
  where id=p_organisation_id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id)
  values(p_organisation_id,(select auth.uid()),'company_details_changed','organisation',p_organisation_id);
end; $$;

create or replace function public.admin_set_staff_roles(
  p_organisation_id uuid,p_user_id uuid,p_roles public.staff_role[]
) returns void language plpgsql security definer set search_path='' as $$
declare v public.organisation_memberships%rowtype; v_role public.staff_role;
begin
  if not private.has_staff_permission(p_organisation_id,'manage_staff') then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  if p_roles is null or cardinality(p_roles)=0 then raise exception 'AT_LEAST_ONE_ROLE_REQUIRED' using errcode='22023'; end if;
  if 'head_broker'::public.staff_role=any(p_roles) then raise exception 'HEAD_BROKER_CHANGES_REQUIRE_OWNERSHIP_TRANSFER' using errcode='42501'; end if;
  if cardinality(p_roles)<>(select count(distinct x) from unnest(p_roles)x) then raise exception 'DUPLICATE_ROLE' using errcode='22023'; end if;
  select * into v from public.organisation_memberships where organisation_id=p_organisation_id and user_id=p_user_id for update;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode='P0002'; end if;
  if private.is_head_broker(p_organisation_id,p_user_id) then raise exception 'HEAD_BROKER_IS_PROTECTED' using errcode='42501'; end if;
  if v.status<>'active' or v.removed_at is not null then raise exception 'STAFF_MUST_BE_ACTIVE_TO_CHANGE_ACCESS' using errcode='55000'; end if;
  delete from public.organisation_member_roles where membership_id=v.id;
  foreach v_role in array p_roles loop
    insert into public.organisation_member_roles(membership_id,organisation_id,user_id,role,granted_by_user_id)
    values(v.id,p_organisation_id,p_user_id,v_role,(select auth.uid()));
  end loop;
  update public.organisation_memberships set role=private.legacy_role_for_staff(p_roles),updated_at=now() where id=v.id;
  if 'broker'::public.staff_role=any(p_roles) then
    insert into public.broker_profiles(organisation_id,user_id,broker_code,title,is_active)
    values(p_organisation_id,p_user_id,'BR-'||upper(substr(replace(p_user_id::text,'-',''),1,8)),'Mortgage Broker',true)
    on conflict(organisation_id,user_id) do update set is_active=true,updated_at=now();
  else
    update public.broker_profiles set is_active=false,updated_at=now() where organisation_id=p_organisation_id and user_id=p_user_id;
  end if;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organisation_id,(select auth.uid()),'staff_roles_changed','organisation_membership',v.id,jsonb_build_object('roles',p_roles));
end; $$;

create or replace function public.admin_set_staff_permissions(
  p_organisation_id uuid,p_user_id uuid,p_permissions public.staff_permission[]
) returns void language plpgsql security definer set search_path='' as $$
declare v public.organisation_memberships%rowtype; v_permission public.staff_permission;
begin
  if not private.has_staff_permission(p_organisation_id,'manage_staff') then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  if private.is_head_broker(p_organisation_id,p_user_id) then raise exception 'HEAD_BROKER_PERMISSIONS_ARE_INHERENT' using errcode='42501'; end if;
  if 'manage_company'::public.staff_permission=any(coalesce(p_permissions,array[]::public.staff_permission[])) then
    raise exception 'COMPANY_MANAGEMENT_CANNOT_BE_DELEGATED' using errcode='42501';
  end if;
  select * into v from public.organisation_memberships where organisation_id=p_organisation_id and user_id=p_user_id for update;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode='P0002'; end if;
  if v.status<>'active' or v.removed_at is not null then raise exception 'STAFF_MUST_BE_ACTIVE_TO_CHANGE_ACCESS' using errcode='55000'; end if;
  delete from public.organisation_member_permissions where membership_id=v.id;
  foreach v_permission in array coalesce(p_permissions,array[]::public.staff_permission[]) loop
    insert into public.organisation_member_permissions(membership_id,organisation_id,user_id,permission,granted_by_user_id)
    values(v.id,p_organisation_id,p_user_id,v_permission,(select auth.uid()));
  end loop;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organisation_id,(select auth.uid()),'staff_permissions_changed','organisation_membership',v.id,
    jsonb_build_object('permissions',coalesce(p_permissions,array[]::public.staff_permission[])));
end; $$;

create or replace function public.admin_set_staff_status(
  p_organisation_id uuid,p_user_id uuid,p_status public.membership_status,p_reason text default null
) returns void language plpgsql security definer set search_path='' as $$
declare v public.organisation_memberships%rowtype;
begin
  if not private.has_staff_permission(p_organisation_id,'manage_staff') then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  if p_status not in ('active','disabled') then raise exception 'STATUS_MUST_BE_ACTIVE_OR_DISABLED' using errcode='22023'; end if;
  select * into v from public.organisation_memberships where organisation_id=p_organisation_id and user_id=p_user_id for update;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode='P0002'; end if;
  if private.is_head_broker(p_organisation_id,p_user_id) then raise exception 'HEAD_BROKER_MUST_TRANSFER_OWNERSHIP_FIRST' using errcode='23514'; end if;
  update public.organisation_memberships set status=p_status,
    activated_at=case when p_status='active' then coalesce(activated_at,now()) else activated_at end,
    disabled_at=case when p_status='disabled' then now() else null end,
    disabled_by_user_id=case when p_status='disabled' then (select auth.uid()) else null end,
    disabled_reason=case when p_status='disabled' then nullif(trim(p_reason),'') else null end,updated_at=now()
  where id=v.id;
  update public.broker_profiles set is_active=(p_status='active'),updated_at=now()
  where organisation_id=p_organisation_id and user_id=p_user_id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organisation_id,(select auth.uid()),'staff_status_changed','organisation_membership',v.id,
    jsonb_build_object('from',v.status,'to',p_status,'reason',p_reason));
end; $$;

create or replace function public.admin_archive_staff(p_organisation_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.organisation_memberships%rowtype; v_clients bigint; v_days integer;
begin
  if not private.has_staff_permission(p_organisation_id,'manage_staff') then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  if private.is_head_broker(p_organisation_id,p_user_id) then raise exception 'HEAD_BROKER_MUST_TRANSFER_OWNERSHIP_FIRST' using errcode='23514'; end if;
  select * into v from public.organisation_memberships where organisation_id=p_organisation_id and user_id=p_user_id for update;
  if not found or v.status<>'disabled' or v.removed_at is not null then raise exception 'STAFF_MUST_BE_DISABLED_FIRST' using errcode='55000'; end if;
  select count(*) into v_clients from public.client_assignments where organisation_id=p_organisation_id and member_user_id=p_user_id;
  if v_clients>0 then raise exception 'TRANSFER_CLIENTS_BEFORE_REMOVAL' using errcode='23514'; end if;
  select removal_hold_days into v_days from private.staff_lifecycle_config where singleton;
  if now()<coalesce(v.removal_available_at,v.disabled_at+make_interval(days=>v_days)) then raise exception 'REMOVAL_WAITING_PERIOD_NOT_FINISHED' using errcode='55000'; end if;
  update public.organisation_memberships set removed_at=now(),updated_at=now() where id=v.id;
  update public.broker_profiles set is_active=false,updated_at=now() where organisation_id=p_organisation_id and user_id=p_user_id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id)
  values(p_organisation_id,(select auth.uid()),'staff_archived','organisation_membership',v.id);
end; $$;

create or replace function public.admin_transfer_head_broker(
  p_organisation_id uuid,p_new_head_broker_user_id uuid,
  p_former_head_broker_roles public.staff_role[] default array['broker']::public.staff_role[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_old_user_id uuid;
  v_old public.organisation_memberships%rowtype;
  v_new public.organisation_memberships%rowtype;
  v_role public.staff_role;
begin
  select head_broker_user_id into v_old_user_id from public.organisations where id=p_organisation_id for update;
  if not found then raise exception 'ORGANISATION_NOT_FOUND' using errcode='P0002'; end if;
  if not private.is_platform_admin() and (select auth.uid()) is distinct from v_old_user_id then
    raise exception 'CURRENT_HEAD_BROKER_REQUIRED' using errcode='42501';
  end if;
  if p_new_head_broker_user_id=v_old_user_id then raise exception 'NEW_HEAD_BROKER_MUST_BE_DIFFERENT' using errcode='22023'; end if;
  if p_former_head_broker_roles is null or cardinality(p_former_head_broker_roles)=0 then raise exception 'FORMER_HEAD_BROKER_REQUIRES_A_ROLE' using errcode='22023'; end if;
  if 'head_broker'::public.staff_role=any(p_former_head_broker_roles) then raise exception 'FORMER_ROLES_CANNOT_INCLUDE_HEAD_BROKER' using errcode='22023'; end if;
  select * into v_old from public.organisation_memberships where organisation_id=p_organisation_id and user_id=v_old_user_id for update;
  select * into v_new from public.organisation_memberships where organisation_id=p_organisation_id and user_id=p_new_head_broker_user_id for update;
  if not found or v_new.status<>'active' or v_new.removed_at is not null then raise exception 'NEW_HEAD_BROKER_MUST_BE_ACTIVE_STAFF' using errcode='23514'; end if;
  perform set_config('brokerrelay.head_broker_transfer',p_organisation_id::text,true);
  delete from public.organisation_member_roles where membership_id=v_old.id;
  foreach v_role in array p_former_head_broker_roles loop
    insert into public.organisation_member_roles(membership_id,organisation_id,user_id,role,granted_by_user_id)
    values(v_old.id,p_organisation_id,v_old_user_id,v_role,(select auth.uid()));
  end loop;
  insert into public.organisation_member_roles(membership_id,organisation_id,user_id,role,granted_by_user_id)
  values(v_new.id,p_organisation_id,p_new_head_broker_user_id,'head_broker',(select auth.uid()))
  on conflict(membership_id,role) do nothing;
  update public.organisations set head_broker_user_id=p_new_head_broker_user_id,updated_at=now() where id=p_organisation_id;
  update public.organisation_memberships set role=private.legacy_role_for_staff(p_former_head_broker_roles),updated_at=now() where id=v_old.id;
  update public.organisation_memberships set role='company_admin',updated_at=now() where id=v_new.id;
  insert into public.broker_profiles(organisation_id,user_id,broker_code,title,is_active)
  values(p_organisation_id,p_new_head_broker_user_id,'BR-'||upper(substr(replace(p_new_head_broker_user_id::text,'-',''),1,8)),'Head Broker',true)
  on conflict(organisation_id,user_id) do update set title='Head Broker',is_active=true,updated_at=now();
  if 'broker'::public.staff_role=any(p_former_head_broker_roles) then
    update public.broker_profiles set is_active=true,title=case when title='Head Broker' then 'Mortgage Broker' else title end,updated_at=now()
    where organisation_id=p_organisation_id and user_id=v_old_user_id;
  else
    update public.broker_profiles set is_active=false,updated_at=now() where organisation_id=p_organisation_id and user_id=v_old_user_id;
  end if;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organisation_id,(select auth.uid()),'head_broker_ownership_transferred','organisation',p_organisation_id,
    jsonb_build_object('former_head_broker_user_id',v_old_user_id,'new_head_broker_user_id',p_new_head_broker_user_id,
      'former_head_broker_roles',p_former_head_broker_roles));
  perform set_config('brokerrelay.head_broker_transfer','',true);
  return jsonb_build_object('former_head_broker_user_id',v_old_user_id,'new_head_broker_user_id',p_new_head_broker_user_id);
end; $$;

-- Invitations can never create or replace company ownership.
create or replace function public.service_create_staff_invitation(
  p_actor_user_id uuid,p_organisation_id uuid,p_user_id uuid,p_email text,
  p_first_name text,p_last_name text,p_roles public.staff_role[],
  p_broker_code text default null,p_title text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_member public.organisation_memberships%rowtype;
begin
  if not private.actor_can_manage_staff(p_actor_user_id,p_organisation_id) then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  if p_roles is null or cardinality(p_roles)=0 then raise exception 'AT_LEAST_ONE_ROLE_REQUIRED' using errcode='22023'; end if;
  if 'head_broker'::public.staff_role=any(p_roles) then raise exception 'HEAD_BROKER_CANNOT_BE_INVITED' using errcode='42501'; end if;
  select * into v_member from public.organisation_memberships where organisation_id=p_organisation_id and user_id=p_user_id;
  if found and v_member.removed_at is null and v_member.status='active' then raise exception 'STAFF_ALREADY_ACTIVE' using errcode='23505'; end if;
  if found and v_member.removed_at is null and v_member.status='disabled' then raise exception 'STAFF_DISABLED_REACTIVATE' using errcode='55000'; end if;
  if exists(select 1 from private.staff_invitations where organisation_id=p_organisation_id and lower(email)=lower(trim(p_email)) and status='pending') then
    raise exception 'INVITATION_ALREADY_PENDING_USE_RESEND' using errcode='23505';
  end if;
  insert into private.staff_invitations(organisation_id,auth_user_id,email,first_name,last_name,broker_code,title,roles,invited_by_user_id)
  values(p_organisation_id,p_user_id,lower(trim(p_email)),trim(p_first_name),trim(p_last_name),nullif(trim(p_broker_code),''),nullif(trim(p_title),''),p_roles,p_actor_user_id)
  returning id into v_id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organisation_id,p_actor_user_id,'staff_invited','staff_invitation',v_id,jsonb_build_object('email',lower(trim(p_email)),'roles',p_roles));
  return v_id;
end; $$;

update private.staff_invitations set status='cancelled',cancelled_at=now()
where status='pending' and 'head_broker'::public.staff_role=any(roles);

revoke all on function private.is_head_broker(uuid,uuid) from public,anon,authenticated;
revoke all on function private.guard_head_broker_role() from public,anon,authenticated;
revoke all on function private.guard_head_broker_membership() from public,anon,authenticated;
revoke all on function public.service_add_invited_staff(uuid,uuid,uuid,public.staff_role[],text,text) from service_role;
revoke all on function public.admin_transfer_head_broker(uuid,uuid,public.staff_role[]) from public,anon;
grant execute on function public.admin_transfer_head_broker(uuid,uuid,public.staff_role[]) to authenticated;

notify pgrst,'reload schema';
commit;
