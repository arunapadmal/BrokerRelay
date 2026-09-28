begin;

-- M7D: company identity integrity, single-company staff, and consent-based ownership handover.
alter table public.organisations
  add column if not exists identity_locked boolean not null default false,
  add column if not exists identity_verified_at timestamptz,
  add column if not exists identity_verified_by uuid references auth.users(id) on delete set null;

-- Existing tenants are intentionally left unlocked. Their identity must be checked by a platform
-- administrator before it is finalized; this avoids locking legacy/test values as legal truth.

do $$
begin
  if exists (
    select 1 from public.organisation_memberships
    where removed_at is null
    group by user_id having count(*) > 1
  ) then
    raise exception 'M7D_BLOCKED_USER_HAS_MULTIPLE_COMPANIES: repair duplicate memberships before applying';
  end if;
end $$;

create unique index if not exists organisation_memberships_one_company_per_user
  on public.organisation_memberships(user_id) where removed_at is null;

drop index if exists private.staff_invitations_one_pending_email;
create unique index if not exists staff_invitations_one_pending_email_global
  on private.staff_invitations(lower(email)) where status='pending';

create or replace function public.service_staff_invite_preflight(p_actor_user_id uuid,p_organisation_id uuid,p_user_id uuid,p_email text)
returns text language plpgsql stable security definer set search_path='' as $$
declare v public.organisation_memberships%rowtype;
begin
  if not private.actor_can_manage_staff(p_actor_user_id,p_organisation_id) then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  if exists(select 1 from private.staff_invitations where lower(email)=lower(trim(p_email)) and status='pending') then return 'pending'; end if;
  if p_user_id is not null then
    select * into v from public.organisation_memberships where user_id=p_user_id and removed_at is null limit 1;
    if found and v.organisation_id<>p_organisation_id then return 'other_company'; end if;
    if found and v.status='active' then return 'active'; end if;
    if found and v.status='disabled' then return 'disabled'; end if;
  end if;
  return 'allowed';
end $$;

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
  select * into v_member from public.organisation_memberships where user_id=p_user_id and removed_at is null limit 1;
  if found and v_member.organisation_id<>p_organisation_id then raise exception 'STAFF_ALREADY_BELONGS_TO_ANOTHER_COMPANY' using errcode='23505'; end if;
  if found and v_member.status='active' then raise exception 'STAFF_ALREADY_ACTIVE' using errcode='23505'; end if;
  if found and v_member.status='disabled' then raise exception 'STAFF_DISABLED_REACTIVATE' using errcode='55000'; end if;
  if exists(select 1 from private.staff_invitations where lower(email)=lower(trim(p_email)) and status='pending') then raise exception 'INVITATION_ALREADY_PENDING_USE_RESEND' using errcode='23505'; end if;
  insert into private.staff_invitations(organisation_id,auth_user_id,email,first_name,last_name,broker_code,title,roles,invited_by_user_id)
  values(p_organisation_id,p_user_id,lower(trim(p_email)),trim(p_first_name),trim(p_last_name),nullif(trim(p_broker_code),''),nullif(trim(p_title),''),p_roles,p_actor_user_id)
  returning id into v_id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organisation_id,p_actor_user_id,'staff_invited','staff_invitation',v_id,jsonb_build_object('email',lower(trim(p_email)),'roles',p_roles));
  return v_id;
end $$;

create or replace function public.accept_staff_invitation(p_organisation_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_inv private.staff_invitations%rowtype; v_mid uuid; v_role public.staff_role; v_email text;
begin
  if exists(select 1 from public.organisation_memberships where user_id=(select auth.uid()) and removed_at is null and organisation_id<>p_organisation_id) then
    raise exception 'STAFF_ALREADY_BELONGS_TO_ANOTHER_COMPANY' using errcode='23505';
  end if;
  select email into v_email from auth.users where id=(select auth.uid());
  select * into v_inv from private.staff_invitations where organisation_id=p_organisation_id and lower(email)=lower(v_email) and status='pending' and expires_at>now() for update;
  if not found then raise exception 'PENDING_INVITATION_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.organisation_memberships(organisation_id,user_id,role,status,invited_at,activated_at,removed_at,removal_available_at)
  values(p_organisation_id,(select auth.uid()),private.legacy_role_for_staff(v_inv.roles),'active',v_inv.created_at,now(),null,null)
  on conflict(organisation_id,user_id) do update set role=excluded.role,status='active',activated_at=now(),removed_at=null,removal_available_at=null,disabled_at=null,disabled_reason=null,updated_at=now()
  returning id into v_mid;
  delete from public.organisation_member_roles where membership_id=v_mid;
  foreach v_role in array v_inv.roles loop
    insert into public.organisation_member_roles(membership_id,organisation_id,user_id,role,granted_by_user_id) values(v_mid,p_organisation_id,(select auth.uid()),v_role,v_inv.invited_by_user_id);
  end loop;
  if v_inv.roles && array['broker']::public.staff_role[] then
    insert into public.broker_profiles(organisation_id,user_id,broker_code,title,is_active)
    values(p_organisation_id,(select auth.uid()),coalesce(v_inv.broker_code,'BR-'||upper(substr(replace((select auth.uid())::text,'-',''),1,8))),coalesce(v_inv.title,'Mortgage Broker'),true)
    on conflict(organisation_id,user_id) do update set is_active=true,broker_code=excluded.broker_code,title=excluded.title,updated_at=now();
  end if;
  update private.staff_invitations set status='accepted',accepted_at=now(),auth_user_id=(select auth.uid()) where id=v_inv.id;
  return v_mid;
end $$;

create or replace function private.guard_company_legal_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if (new.name,new.legal_name,new.abn) is distinct from (old.name,old.legal_name,old.abn)
     and coalesce(current_setting('brokerrelay.company_identity_change',true),'') <> old.id::text then
    raise exception 'COMPANY_LEGAL_IDENTITY_IS_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_company_legal_identity on public.organisations;
create trigger guard_company_legal_identity before update on public.organisations
for each row execute function private.guard_company_legal_identity();

create or replace function public.admin_update_company_contacts(
  p_organisation_id uuid,p_billing_email text default null,
  p_contact_phone text default null,p_website text default null
) returns void language plpgsql security definer set search_path='' as $$
declare v_phone text:=nullif(trim(p_contact_phone),''); v_website text:=nullif(trim(p_website),'');
begin
  if not private.is_platform_admin() and not private.is_head_broker(p_organisation_id,(select auth.uid())) then
    raise exception 'HEAD_BROKER_REQUIRED_FOR_COMPANY_MANAGEMENT' using errcode='42501';
  end if;
  if nullif(trim(p_billing_email),'') is not null and trim(p_billing_email)!~*'^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'INVALID_BILLING_EMAIL' using errcode='22023';
  end if;
  if v_phone is not null and (v_phone!~'^[+()0-9[:space:]\-]+$'
    or not ((length(regexp_replace(v_phone,'[^0-9]','','g'))=10 and regexp_replace(v_phone,'[^0-9]','','g') like '0%')
      or (length(regexp_replace(v_phone,'[^0-9]','','g'))=11 and regexp_replace(v_phone,'[^0-9]','','g') like '61%'))) then
    raise exception 'INVALID_PHONE' using errcode='22023';
  end if;
  if v_website is not null and v_website!~*'^https?://[^[:space:]]+$' then raise exception 'INVALID_WEBSITE' using errcode='22023'; end if;
  update public.organisations set billing_email=nullif(lower(trim(p_billing_email)),''),
    contact_phone=v_phone,website=v_website,updated_at=now() where id=p_organisation_id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id)
  values(p_organisation_id,(select auth.uid()),'company_contacts_changed','organisation',p_organisation_id);
end $$;

create or replace function public.platform_finalize_company_identity(
  p_organisation_id uuid,p_name text,p_legal_name text,p_abn text
) returns void language plpgsql security definer set search_path='' as $$
declare v_abn text:=regexp_replace(coalesce(p_abn,''),'[^0-9]','','g'); v_locked boolean;
begin
  if not private.is_platform_admin() then raise exception 'PLATFORM_ADMIN_REQUIRED' using errcode='42501'; end if;
  select identity_locked into v_locked from public.organisations where id=p_organisation_id for update;
  if not found then raise exception 'ORGANISATION_NOT_FOUND' using errcode='P0002'; end if;
  if v_locked then raise exception 'COMPANY_IDENTITY_ALREADY_LOCKED' using errcode='55000'; end if;
  if nullif(trim(p_name),'') is null or nullif(trim(p_legal_name),'') is null then raise exception 'COMPANY_NAMES_REQUIRED' using errcode='22023'; end if;
  if not private.valid_abn(v_abn) then raise exception 'INVALID_ABN' using errcode='22023'; end if;
  perform set_config('brokerrelay.company_identity_change',p_organisation_id::text,true);
  update public.organisations set name=trim(p_name),legal_name=trim(p_legal_name),abn=v_abn,
    identity_locked=true,identity_verified_at=now(),identity_verified_by=(select auth.uid()),updated_at=now()
  where id=p_organisation_id;
  perform set_config('brokerrelay.company_identity_change','',true);
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id)
  values(p_organisation_id,(select auth.uid()),'company_identity_finalized','organisation',p_organisation_id);
end $$;

create table if not exists private.head_broker_transfers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  from_user_id uuid not null references auth.users(id) on delete restrict,
  to_user_id uuid not null references auth.users(id) on delete restrict,
  former_head_broker_roles public.staff_role[] not null,
  state text not null check(state in ('awaiting_current_confirmation','awaiting_successor','completed','cancelled','declined','expired')),
  initiated_at timestamptz not null default now(), current_confirmed_at timestamptz,
  successor_responded_at timestamptz, completed_at timestamptz, cancelled_at timestamptz,
  expires_at timestamptz not null default (now()+interval '48 hours'),
  check(from_user_id<>to_user_id)
);
alter table private.head_broker_transfers enable row level security;
revoke all on private.head_broker_transfers from public,anon,authenticated;
create unique index if not exists head_broker_transfer_one_open_per_org
  on private.head_broker_transfers(organisation_id)
  where state in ('awaiting_current_confirmation','awaiting_successor');

create or replace function private.has_recent_auth(p_seconds integer default 900)
returns boolean language sql stable set search_path='' as $$
  select coalesce((select max((entry->>'timestamp')::bigint) from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) as x(entry))
    >= extract(epoch from now())::bigint-p_seconds,false)
$$;

create or replace function public.admin_initiate_head_broker_transfer(
  p_organisation_id uuid,p_new_head_broker_user_id uuid,
  p_former_head_broker_roles public.staff_role[] default array['broker']::public.staff_role[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_head uuid; v_id uuid;
begin
  select head_broker_user_id into v_head from public.organisations where id=p_organisation_id for update;
  if v_head is distinct from (select auth.uid()) then raise exception 'CURRENT_HEAD_BROKER_REQUIRED' using errcode='42501'; end if;
  if p_new_head_broker_user_id=v_head then raise exception 'NEW_HEAD_BROKER_MUST_BE_DIFFERENT' using errcode='22023'; end if;
  if p_former_head_broker_roles is null or cardinality(p_former_head_broker_roles)=0 or 'head_broker'::public.staff_role=any(p_former_head_broker_roles) then
    raise exception 'INVALID_FORMER_HEAD_BROKER_ROLES' using errcode='22023';
  end if;
  if not exists(select 1 from public.organisation_memberships where organisation_id=p_organisation_id
    and user_id=p_new_head_broker_user_id and status='active' and removed_at is null) then
    raise exception 'NEW_HEAD_BROKER_MUST_BE_ACTIVE_SAME_COMPANY_STAFF' using errcode='23514';
  end if;
  update private.head_broker_transfers set state='expired'
    where organisation_id=p_organisation_id and state in ('awaiting_current_confirmation','awaiting_successor') and expires_at<=now();
  insert into private.head_broker_transfers(organisation_id,from_user_id,to_user_id,former_head_broker_roles,state)
  values(p_organisation_id,v_head,p_new_head_broker_user_id,p_former_head_broker_roles,'awaiting_current_confirmation') returning id into v_id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organisation_id,(select auth.uid()),'head_broker_transfer_initiated','head_broker_transfer',v_id,
    jsonb_build_object('to_user_id',p_new_head_broker_user_id,'expires_at',now()+interval '48 hours'));
  return v_id;
end $$;

create or replace function public.get_my_security_actions()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'organisation_id',t.organisation_id,'organisation_name',o.name,'state',t.state,
    'action',case when t.from_user_id=(select auth.uid()) and t.state='awaiting_current_confirmation' then 'confirm_current'
      when t.from_user_id=(select auth.uid()) and t.state='awaiting_successor' then 'cancel_current'
      when t.to_user_id=(select auth.uid()) and t.state='awaiting_successor' then 'respond_successor' end,
    'counterparty_name',trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),
    'expires_at',t.expires_at
  ) order by t.initiated_at desc),'[]'::jsonb)
  from private.head_broker_transfers t join public.organisations o on o.id=t.organisation_id
  left join public.profiles p on p.id=case when t.from_user_id=(select auth.uid()) then t.to_user_id else t.from_user_id end
  where t.expires_at>now() and ((t.from_user_id=(select auth.uid()) and t.state in ('awaiting_current_confirmation','awaiting_successor'))
    or (t.to_user_id=(select auth.uid()) and t.state='awaiting_successor'))
$$;

create or replace function public.confirm_head_broker_transfer_current(p_transfer_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v private.head_broker_transfers%rowtype;
begin
  select * into v from private.head_broker_transfers where id=p_transfer_id for update;
  if not found or v.from_user_id is distinct from (select auth.uid()) or v.state<>'awaiting_current_confirmation' then raise exception 'TRANSFER_NOT_AVAILABLE' using errcode='55000'; end if;
  if v.expires_at<=now() then update private.head_broker_transfers set state='expired' where id=v.id; raise exception 'TRANSFER_EXPIRED' using errcode='55000'; end if;
  if not private.has_recent_auth(900) then raise exception 'RECENT_AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  update private.head_broker_transfers set state='awaiting_successor',current_confirmed_at=now() where id=v.id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id)
  values(v.organisation_id,(select auth.uid()),'head_broker_transfer_current_confirmed','head_broker_transfer',v.id);
end $$;

create or replace function public.respond_head_broker_transfer(p_transfer_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v private.head_broker_transfers%rowtype; v_old public.organisation_memberships%rowtype; v_new public.organisation_memberships%rowtype; v_role public.staff_role;
begin
  select * into v from private.head_broker_transfers where id=p_transfer_id for update;
  if not found or v.to_user_id is distinct from (select auth.uid()) or v.state<>'awaiting_successor' then raise exception 'TRANSFER_NOT_AVAILABLE' using errcode='55000'; end if;
  if v.expires_at<=now() then update private.head_broker_transfers set state='expired' where id=v.id; raise exception 'TRANSFER_EXPIRED' using errcode='55000'; end if;
  if not private.has_recent_auth(900) then raise exception 'RECENT_AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if not p_accept then
    update private.head_broker_transfers set state='declined',successor_responded_at=now() where id=v.id;
    insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id) values(v.organisation_id,(select auth.uid()),'head_broker_transfer_declined','head_broker_transfer',v.id);
    return;
  end if;
  perform 1 from public.organisations where id=v.organisation_id and head_broker_user_id=v.from_user_id for update;
  if not found then raise exception 'HEAD_BROKER_CHANGED' using errcode='40001'; end if;
  select * into v_old from public.organisation_memberships where organisation_id=v.organisation_id and user_id=v.from_user_id for update;
  select * into v_new from public.organisation_memberships where organisation_id=v.organisation_id and user_id=v.to_user_id and status='active' and removed_at is null for update;
  if not found then raise exception 'SUCCESSOR_NOT_ACTIVE' using errcode='23514'; end if;
  perform set_config('brokerrelay.head_broker_transfer',v.organisation_id::text,true);
  delete from public.organisation_member_roles where membership_id=v_old.id;
  foreach v_role in array v.former_head_broker_roles loop
    insert into public.organisation_member_roles(membership_id,organisation_id,user_id,role,granted_by_user_id) values(v_old.id,v.organisation_id,v.from_user_id,v_role,(select auth.uid()));
  end loop;
  insert into public.organisation_member_roles(membership_id,organisation_id,user_id,role,granted_by_user_id)
    values(v_new.id,v.organisation_id,v.to_user_id,'head_broker',(select auth.uid())) on conflict(membership_id,role) do nothing;
  update public.organisations set head_broker_user_id=v.to_user_id,updated_at=now() where id=v.organisation_id;
  update public.organisation_memberships set role=private.legacy_role_for_staff(v.former_head_broker_roles),updated_at=now() where id=v_old.id;
  update public.organisation_memberships set role='company_admin',updated_at=now() where id=v_new.id;
  insert into public.broker_profiles(organisation_id,user_id,broker_code,title,is_active)
    values(v.organisation_id,v.to_user_id,'BR-'||upper(substr(replace(v.to_user_id::text,'-',''),1,8)),'Head Broker',true)
    on conflict(organisation_id,user_id) do update set title='Head Broker',is_active=true,updated_at=now();
  if 'broker'::public.staff_role=any(v.former_head_broker_roles) then
    update public.broker_profiles set is_active=true,title=case when title='Head Broker' then 'Mortgage Broker' else title end,updated_at=now()
      where organisation_id=v.organisation_id and user_id=v.from_user_id;
  else
    update public.broker_profiles set is_active=false,updated_at=now() where organisation_id=v.organisation_id and user_id=v.from_user_id;
  end if;
  perform set_config('brokerrelay.head_broker_transfer','',true);
  update private.head_broker_transfers set state='completed',successor_responded_at=now(),completed_at=now() where id=v.id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
    values(v.organisation_id,(select auth.uid()),'head_broker_ownership_transferred','head_broker_transfer',v.id,jsonb_build_object('from_user_id',v.from_user_id,'to_user_id',v.to_user_id));
end $$;

create or replace function public.cancel_head_broker_transfer(p_transfer_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v private.head_broker_transfers%rowtype;
begin
  select * into v from private.head_broker_transfers where id=p_transfer_id for update;
  if not found or v.from_user_id is distinct from (select auth.uid()) or v.state not in ('awaiting_current_confirmation','awaiting_successor') then raise exception 'TRANSFER_NOT_CANCELLABLE' using errcode='55000'; end if;
  update private.head_broker_transfers set state='cancelled',cancelled_at=now() where id=v.id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id) values(v.organisation_id,(select auth.uid()),'head_broker_transfer_cancelled','head_broker_transfer',v.id);
end $$;

-- The v0.7.5 immediate transfer path is retired.
revoke all on function public.admin_transfer_head_broker(uuid,uuid,public.staff_role[]) from authenticated;
revoke all on function public.admin_update_company(uuid,text,text,text,text,text,text) from authenticated;
revoke all on function private.guard_company_legal_identity() from public,anon,authenticated;
revoke all on function private.has_recent_auth(integer) from public,anon,authenticated;
revoke all on function public.platform_finalize_company_identity(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.platform_finalize_company_identity(uuid,text,text,text) to authenticated;
revoke all on function public.admin_update_company_contacts(uuid,text,text,text) from public,anon;
grant execute on function public.admin_update_company_contacts(uuid,text,text,text) to authenticated;
revoke all on function public.admin_initiate_head_broker_transfer(uuid,uuid,public.staff_role[]) from public,anon;
grant execute on function public.admin_initiate_head_broker_transfer(uuid,uuid,public.staff_role[]) to authenticated;
revoke all on function public.get_my_security_actions() from public,anon;
grant execute on function public.get_my_security_actions() to authenticated;
revoke all on function public.confirm_head_broker_transfer_current(uuid) from public,anon;
grant execute on function public.confirm_head_broker_transfer_current(uuid) to authenticated;
revoke all on function public.respond_head_broker_transfer(uuid,boolean) from public,anon;
grant execute on function public.respond_head_broker_transfer(uuid,boolean) to authenticated;
revoke all on function public.cancel_head_broker_transfer(uuid) from public,anon;
grant execute on function public.cancel_head_broker_transfer(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
