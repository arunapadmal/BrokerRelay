begin;

-- Company details are validated server-side as well as in the browser.
create or replace function private.valid_abn(p_abn text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  d text := regexp_replace(coalesce(p_abn, ''), '[^0-9]', '', 'g');
  weights integer[] := array[10,1,3,5,7,9,11,13,15,17,19];
  total integer := 0;
  i integer;
begin
  if d = '' then return true; end if;
  if length(d) <> 11 then return false; end if;
  for i in 1..11 loop
    total := total + ((substr(d, i, 1)::integer - case when i = 1 then 1 else 0 end) * weights[i]);
  end loop;
  return total % 89 = 0;
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
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_abn text := nullif(regexp_replace(coalesce(p_abn, ''), '[^0-9]', '', 'g'), '');
  v_phone text := nullif(trim(p_contact_phone), '');
  v_website text := nullif(trim(p_website), '');
begin
  if not private.has_staff_permission(p_organisation_id, 'manage_company') then
    raise exception 'COMPANY_MANAGEMENT_NOT_AUTHORISED' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 160 then
    raise exception 'INVALID_COMPANY_NAME' using errcode = '22023';
  end if;
  if p_legal_name is not null and length(trim(p_legal_name)) > 200 then
    raise exception 'INVALID_LEGAL_NAME' using errcode = '22023';
  end if;
  if not private.valid_abn(v_abn) then
    raise exception 'INVALID_ABN' using errcode = '22023';
  end if;
  if nullif(trim(p_billing_email), '') is not null
     and trim(p_billing_email) !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'INVALID_BILLING_EMAIL' using errcode = '22023';
  end if;
  if v_phone is not null and (v_phone !~ '^[+()0-9[:space:]\-]+$'
      or not ((length(regexp_replace(v_phone,'[^0-9]','','g'))=10 and regexp_replace(v_phone,'[^0-9]','','g') like '0%')
           or (length(regexp_replace(v_phone,'[^0-9]','','g'))=11 and regexp_replace(v_phone,'[^0-9]','','g') like '61%'))) then
    raise exception 'INVALID_PHONE' using errcode = '22023';
  end if;
  if v_website is not null and v_website !~* '^https?://[^[:space:]]+$' then
    raise exception 'INVALID_WEBSITE' using errcode = '22023';
  end if;

  update public.organisations set
    name = trim(p_name), legal_name = nullif(trim(p_legal_name), ''), abn = v_abn,
    billing_email = nullif(lower(trim(p_billing_email)), ''), contact_phone = v_phone,
    website = v_website, updated_at = now()
  where id = p_organisation_id;
  insert into public.audit_events
    (organisation_id, actor_user_id, event_type, entity_type, entity_id)
  values (p_organisation_id, (select auth.uid()), 'company_details_changed', 'organisation', p_organisation_id);
end;
$$;

-- Every invitation remains pending until that exact authenticated user accepts it.
create or replace function public.service_add_invited_staff(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_user_id uuid,
  p_roles public.staff_role[],
  p_broker_code text default null,
  p_title text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_membership_id uuid;
  v_existing public.membership_status;
  v_role public.staff_role;
begin
  if not private.actor_can_manage_staff(p_actor_user_id, p_organisation_id) then
    raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode = '42501';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'AT_LEAST_ONE_ROLE_REQUIRED' using errcode = '22023';
  end if;
  if cardinality(p_roles) <> (select count(distinct x) from unnest(p_roles) x) then
    raise exception 'DUPLICATE_ROLE' using errcode = '22023';
  end if;
  select status into v_existing from public.organisation_memberships
  where organisation_id = p_organisation_id and user_id = p_user_id;
  if v_existing = 'active' then raise exception 'STAFF_ALREADY_ACTIVE' using errcode = '23505'; end if;
  if v_existing = 'disabled' then raise exception 'STAFF_IS_DISABLED_USE_REACTIVATE' using errcode = '55000'; end if;

  insert into public.organisation_memberships
    (organisation_id, user_id, role, status, invited_at, activated_at)
  values (p_organisation_id, p_user_id, private.legacy_role_for_staff(p_roles), 'invited', now(), null)
  on conflict (organisation_id, user_id) do update set
    role = excluded.role, status = 'invited', invited_at = now(), activated_at = null, updated_at = now()
  returning id into v_membership_id;

  delete from public.organisation_member_roles where membership_id = v_membership_id;
  foreach v_role in array p_roles loop
    insert into public.organisation_member_roles
      (membership_id, organisation_id, user_id, role, granted_by_user_id)
    values (v_membership_id, p_organisation_id, p_user_id, v_role, p_actor_user_id);
  end loop;

  if p_roles && array['head_broker','broker']::public.staff_role[] then
    insert into public.broker_profiles (organisation_id, user_id, broker_code, title, is_active)
    values (p_organisation_id, p_user_id,
      coalesce(nullif(trim(p_broker_code), ''), 'BR-' || upper(substr(replace(p_user_id::text, '-', ''), 1, 8))),
      coalesce(nullif(trim(p_title), ''), case when 'head_broker'::public.staff_role = any(p_roles) then 'Head Broker' else 'Mortgage Broker' end), false)
    on conflict (organisation_id, user_id) do update set
      broker_code = excluded.broker_code, title = excluded.title, is_active = false, updated_at = now();
  end if;

  insert into public.audit_events
    (organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_organisation_id, p_actor_user_id, 'staff_invited', 'organisation_membership',
          v_membership_id, jsonb_build_object('roles', p_roles));
  return v_membership_id;
end;
$$;

drop trigger if exists on_auth_staff_invite_activated on auth.users;

create or replace function public.get_my_staff_invitations()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'organisation_id', om.organisation_id,
    'organisation_name', o.name,
    'roles', coalesce((select jsonb_agg(mr.role order by mr.role)
                       from public.organisation_member_roles mr
                       where mr.membership_id = om.id), '[]'::jsonb)
  ) order by o.name), '[]'::jsonb)
  from public.organisation_memberships om
  join public.organisations o on o.id = om.organisation_id
  where om.user_id = (select auth.uid()) and om.status = 'invited';
$$;

create or replace function public.accept_staff_invitation(p_organisation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_membership_id uuid;
begin
  update public.organisation_memberships
  set status = 'active', activated_at = now(), disabled_at = null,
      disabled_by_user_id = null, disabled_reason = null, updated_at = now()
  where organisation_id = p_organisation_id and user_id = (select auth.uid()) and status = 'invited'
  returning id into v_membership_id;
  if v_membership_id is null then
    raise exception 'PENDING_INVITATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  update public.broker_profiles set is_active = true, updated_at = now()
  where organisation_id = p_organisation_id and user_id = (select auth.uid());
  insert into public.audit_events
    (organisation_id, actor_user_id, event_type, entity_type, entity_id)
  values (p_organisation_id, (select auth.uid()), 'staff_invitation_accepted',
          'organisation_membership', v_membership_id);
  return v_membership_id;
end;
$$;

-- Database enforcement: invited/disabled records are read-only to normal app users.
create or replace function private.guard_inactive_staff_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_membership_id uuid;
  v_status public.membership_status;
begin
  v_membership_id := case when tg_op = 'DELETE' then old.membership_id else new.membership_id end;
  if (select auth.uid()) is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select status into v_status from public.organisation_memberships where id = v_membership_id;
  if v_status <> 'active' then
    raise exception 'STAFF_MUST_BE_ACTIVE_TO_CHANGE_ACCESS' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists guard_inactive_staff_roles on public.organisation_member_roles;
create trigger guard_inactive_staff_roles before insert or update or delete
on public.organisation_member_roles for each row execute function private.guard_inactive_staff_access();
drop trigger if exists guard_inactive_staff_permissions on public.organisation_member_permissions;
create trigger guard_inactive_staff_permissions before insert or update or delete
on public.organisation_member_permissions for each row execute function private.guard_inactive_staff_access();

create or replace function private.guard_invited_membership_activation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'invited' and new.status = 'active'
     and (select auth.uid()) is distinct from old.user_id then
    raise exception 'INVITEE_MUST_ACCEPT_INVITATION' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_invited_membership_activation on public.organisation_memberships;
create trigger guard_invited_membership_activation before update of status
on public.organisation_memberships for each row execute function private.guard_invited_membership_activation();

revoke all on function public.get_my_staff_invitations() from public, anon;
revoke all on function public.accept_staff_invitation(uuid) from public, anon;
grant execute on function public.get_my_staff_invitations() to authenticated;
grant execute on function public.accept_staff_invitation(uuid) to authenticated;

create table if not exists private.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  email text not null,
  first_name text not null,
  last_name text not null,
  broker_code text,
  title text,
  roles public.staff_role[] not null,
  status text not null default 'pending' check (status in ('pending','accepted','cancelled','expired')),
  invited_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  resend_count integer not null default 0,
  accepted_at timestamptz,
  cancelled_at timestamptz
);
create unique index if not exists staff_invitations_one_pending_email
on private.staff_invitations (organisation_id, lower(email)) where status = 'pending';
alter table private.staff_invitations enable row level security;

alter table public.organisation_memberships
  add column if not exists removed_at timestamptz,
  add column if not exists removal_available_at timestamptz;

create table if not exists private.staff_lifecycle_config (
  singleton boolean primary key default true check (singleton),
  removal_hold_days integer not null default 0 check (removal_hold_days between 0 and 365)
);
insert into private.staff_lifecycle_config(singleton, removal_hold_days)
values (true, 0) on conflict (singleton) do nothing;

create or replace function public.service_create_staff_invitation(
  p_actor_user_id uuid, p_organisation_id uuid, p_user_id uuid, p_email text,
  p_first_name text, p_last_name text, p_roles public.staff_role[],
  p_broker_code text default null, p_title text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_member public.organisation_memberships%rowtype;
begin
  if not private.actor_can_manage_staff(p_actor_user_id, p_organisation_id) then
    raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501';
  end if;
  if p_roles is null or cardinality(p_roles)=0 then raise exception 'AT_LEAST_ONE_ROLE_REQUIRED' using errcode='22023'; end if;
  select * into v_member from public.organisation_memberships
  where organisation_id=p_organisation_id and user_id=p_user_id;
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

create or replace function public.service_staff_invite_preflight(p_actor_user_id uuid,p_organisation_id uuid,p_user_id uuid,p_email text)
returns text language plpgsql stable security definer set search_path='' as $$
declare v public.organisation_memberships%rowtype;
begin
  if not private.actor_can_manage_staff(p_actor_user_id,p_organisation_id) then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  if exists(select 1 from private.staff_invitations where organisation_id=p_organisation_id and lower(email)=lower(trim(p_email)) and status='pending') then return 'pending'; end if;
  if p_user_id is not null then
    select * into v from public.organisation_memberships where organisation_id=p_organisation_id and user_id=p_user_id;
    if found and v.removed_at is null and v.status='active' then return 'active'; end if;
    if found and v.removed_at is null and v.status='disabled' then return 'disabled'; end if;
    if found and v.removed_at is not null then return 'removed'; end if;
  end if;
  return 'allowed';
end; $$;

create or replace function public.service_resend_staff_invitation(p_actor_user_id uuid,p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v private.staff_invitations%rowtype;
begin
  select * into v from private.staff_invitations where id=p_invitation_id for update;
  if not found or v.status<>'pending' then raise exception 'PENDING_INVITATION_NOT_FOUND' using errcode='P0002'; end if;
  if not private.actor_can_manage_staff(p_actor_user_id,v.organisation_id) then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  update private.staff_invitations set last_sent_at=now(),resend_count=resend_count+1,expires_at=now()+interval '7 days' where id=v.id;
  return jsonb_build_object('email',v.email,'organisation_id',v.organisation_id);
end; $$;

create or replace function public.admin_cancel_staff_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
  select organisation_id into v_org from private.staff_invitations where id=p_invitation_id and status='pending' for update;
  if v_org is null then raise exception 'PENDING_INVITATION_NOT_FOUND' using errcode='P0002'; end if;
  if not private.has_staff_permission(v_org,'manage_staff') then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  update private.staff_invitations set status='cancelled',cancelled_at=now() where id=p_invitation_id;
end; $$;

create or replace function public.get_my_staff_invitations()
returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('invitation_id',i.id,'organisation_id',i.organisation_id,'organisation_name',o.name,'roles',to_jsonb(i.roles)) order by o.name),'[]'::jsonb)
from private.staff_invitations i join public.organisations o on o.id=i.organisation_id join auth.users u on u.id=(select auth.uid())
where lower(i.email)=lower(u.email) and i.status='pending' and i.expires_at>now(); $$;

create or replace function public.accept_staff_invitation(p_organisation_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_inv private.staff_invitations%rowtype; v_mid uuid; v_role public.staff_role; v_email text;
begin
  select email into v_email from auth.users where id=(select auth.uid());
  select * into v_inv from private.staff_invitations where organisation_id=p_organisation_id and lower(email)=lower(v_email) and status='pending' and expires_at>now() for update;
  if not found then raise exception 'PENDING_INVITATION_NOT_FOUND' using errcode='P0002'; end if;
  insert into public.organisation_memberships(organisation_id,user_id,role,status,invited_at,activated_at,removed_at,removal_available_at)
  values(p_organisation_id,(select auth.uid()),private.legacy_role_for_staff(v_inv.roles),'active',v_inv.created_at,now(),null,null)
  on conflict(organisation_id,user_id) do update set role=excluded.role,status='active',activated_at=now(),removed_at=null,removal_available_at=null,disabled_at=null,disabled_reason=null,updated_at=now()
  returning id into v_mid;
  delete from public.organisation_member_roles where membership_id=v_mid;
  foreach v_role in array v_inv.roles loop
    insert into public.organisation_member_roles(membership_id,organisation_id,user_id,role,granted_by_user_id)
    values(v_mid,p_organisation_id,(select auth.uid()),v_role,v_inv.invited_by_user_id);
  end loop;
  if v_inv.roles && array['head_broker','broker']::public.staff_role[] then
    insert into public.broker_profiles(organisation_id,user_id,broker_code,title,is_active)
    values(p_organisation_id,(select auth.uid()),coalesce(v_inv.broker_code,'BR-'||upper(substr(replace((select auth.uid())::text,'-',''),1,8))),coalesce(v_inv.title,'Mortgage Broker'),true)
    on conflict(organisation_id,user_id) do update set is_active=true,broker_code=excluded.broker_code,title=excluded.title,updated_at=now();
  end if;
  update private.staff_invitations set status='accepted',accepted_at=now(),auth_user_id=(select auth.uid()) where id=v_inv.id;
  return v_mid;
end; $$;

create or replace function public.admin_archive_staff(p_organisation_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.organisation_memberships%rowtype; v_clients bigint; v_days integer;
begin
  if not private.has_staff_permission(p_organisation_id,'manage_staff') then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  select * into v from public.organisation_memberships where organisation_id=p_organisation_id and user_id=p_user_id for update;
  if not found or v.status<>'disabled' or v.removed_at is not null then raise exception 'STAFF_MUST_BE_DISABLED_FIRST' using errcode='55000'; end if;
  select count(*) into v_clients from public.client_assignments where organisation_id=p_organisation_id and member_user_id=p_user_id;
  if v_clients>0 then raise exception 'TRANSFER_CLIENTS_BEFORE_REMOVAL' using errcode='23514'; end if;
  select removal_hold_days into v_days from private.staff_lifecycle_config where singleton;
  if now()<coalesce(v.removal_available_at,v.disabled_at+make_interval(days=>v_days)) then raise exception 'REMOVAL_WAITING_PERIOD_NOT_FINISHED' using errcode='55000'; end if;
  update public.organisation_memberships set removed_at=now(),updated_at=now() where id=v.id;
  update public.broker_profiles set is_active=false,updated_at=now() where organisation_id=p_organisation_id and user_id=p_user_id;
end; $$;

-- Tighten deactivation: no assigned clients and no last-head-broker removal.
create or replace function private.guard_staff_deactivation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='active' and new.status='disabled' then
    if exists(select 1 from public.client_assignments where organisation_id=old.organisation_id and member_user_id=old.user_id) then
      raise exception 'TRANSFER_CLIENTS_BEFORE_DEACTIVATION' using errcode='23514';
    end if;
    new.removal_available_at:=now()+make_interval(days=>(select removal_hold_days from private.staff_lifecycle_config where singleton));
  end if;
  return new;
end; $$;
drop trigger if exists guard_staff_deactivation on public.organisation_memberships;
create trigger guard_staff_deactivation before update of status on public.organisation_memberships for each row execute function private.guard_staff_deactivation();

revoke all on table private.staff_invitations from public,anon,authenticated;
revoke all on function public.service_create_staff_invitation(uuid,uuid,uuid,text,text,text,public.staff_role[],text,text) from public,anon,authenticated;
revoke all on function public.service_staff_invite_preflight(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.service_resend_staff_invitation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_create_staff_invitation(uuid,uuid,uuid,text,text,text,public.staff_role[],text,text) to service_role;
grant execute on function public.service_staff_invite_preflight(uuid,uuid,uuid,text) to service_role;
grant execute on function public.service_resend_staff_invitation(uuid,uuid) to service_role;
create or replace function public.admin_get_staff_lifecycle(p_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_staff_permission(p_organisation_id,'manage_staff') then raise exception 'STAFF_MANAGEMENT_NOT_AUTHORISED' using errcode='42501'; end if;
  return jsonb_build_object(
    'pending',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'first_name',i.first_name,'last_name',i.last_name,'roles',to_jsonb(i.roles),'last_sent_at',i.last_sent_at,'expires_at',i.expires_at,'resend_count',i.resend_count) order by i.created_at)
      from private.staff_invitations i where i.organisation_id=p_organisation_id and i.status='pending'),'[]'::jsonb),
    'removed_user_ids',coalesce((select jsonb_agg(om.user_id) from public.organisation_memberships om where om.organisation_id=p_organisation_id and om.removed_at is not null),'[]'::jsonb)
  );
end; $$;
revoke all on function public.admin_get_staff_lifecycle(uuid) from public,anon;
grant execute on function public.admin_get_staff_lifecycle(uuid) to authenticated;
revoke all on function public.admin_cancel_staff_invitation(uuid) from public,anon;
revoke all on function public.admin_archive_staff(uuid,uuid) from public,anon;
grant execute on function public.admin_cancel_staff_invitation(uuid) to authenticated;
grant execute on function public.admin_archive_staff(uuid,uuid) to authenticated;

commit;
