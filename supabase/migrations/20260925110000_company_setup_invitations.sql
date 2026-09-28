begin;

create table public.company_setup_invitations (
  id uuid primary key default gen_random_uuid(),
  head_name text not null,
  head_email text not null,
  head_mobile text not null,
  status text not null default 'pending' check (status in ('pending','completed','cancelled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  completed_at timestamptz,
  organisation_id uuid references public.organisations(id),
  check (length(btrim(head_name)) between 2 and 160)
);
create unique index company_setup_one_pending_email on public.company_setup_invitations(head_email)
  where status='pending';
alter table public.company_setup_invitations enable row level security;
revoke all on public.company_setup_invitations from anon, authenticated;

create function public.platform_list_companies()
returns table(id uuid,name text,legal_name text,abn text,status text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() or not exists
    (select 1 from auth.users where id=(select auth.uid()) and lower(email)='aruna@aidez.com.au') then
    raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';
  end if;
  return query select o.id,o.name,o.legal_name,o.abn,o.status::text
    from public.organisations o order by o.created_at;
end $$;

create function public.platform_list_company_invitations()
returns table(id uuid,head_name text,head_email text,head_mobile text,status text,created_at timestamptz,expires_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_platform_admin() or not exists
    (select 1 from auth.users where id=(select auth.uid()) and lower(email)='aruna@aidez.com.au') then
    raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';
  end if;
  return query select i.id,i.head_name,i.head_email,i.head_mobile,i.status,i.created_at,i.expires_at
    from public.company_setup_invitations i order by i.created_at desc limit 100;
end $$;

create function public.platform_invite_company(p_name text,p_email text,p_mobile text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_email text := lower(btrim(coalesce(p_email,'')));
begin
  if not private.is_platform_admin() or not exists
    (select 1 from auth.users where id=(select auth.uid()) and lower(email)='aruna@aidez.com.au') then
    raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_name,''))) not between 2 and 160 or
     v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' or length(v_email)>320 or
     length(regexp_replace(coalesce(p_mobile,''),'[^0-9]','','g')) not between 10 and 12 then
    raise exception 'INVALID_HEAD_BROKER_DETAILS' using errcode='22023';
  end if;
  if exists(select 1 from public.company_setup_invitations where head_email=v_email and status='pending') then
    raise exception 'INVITATION_ALREADY_PENDING' using errcode='23505';
  end if;
  insert into public.company_setup_invitations(head_name,head_email,head_mobile,created_by)
  values(btrim(p_name),v_email,btrim(p_mobile),(select auth.uid())) returning id into v_id;
  return v_id;
end $$;

create function public.platform_cancel_company_invitation(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin() or not exists
    (select 1 from auth.users where id=(select auth.uid()) and lower(email)='aruna@aidez.com.au') then
    raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';
  end if;
  update public.company_setup_invitations set status='cancelled'
  where id=p_id and status='pending';
end $$;

create function public.my_company_setup_invitation()
returns table(id uuid,head_name text,head_email text,head_mobile text,expires_at timestamptz)
language sql stable security definer set search_path='' as $$
  select i.id,i.head_name,i.head_email,i.head_mobile,i.expires_at
  from public.company_setup_invitations i join auth.users u on u.id=(select auth.uid())
  where i.head_email=lower(u.email) and u.email_confirmed_at is not null
    and i.status='pending' and i.expires_at>now()
  order by i.created_at desc limit 1;
$$;

create function public.accept_company_setup_invitation(
  p_invitation_id uuid,p_name text,p_legal_name text,p_abn text,
  p_billing_email text,p_document_delivery_email text,p_phone text,p_website text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_inv public.company_setup_invitations%rowtype;
  v_user uuid := (select auth.uid()); v_org uuid; v_membership uuid;
  v_abn text := regexp_replace(coalesce(p_abn,''),'[^0-9]','','g');
  v_doc text := lower(btrim(coalesce(p_document_delivery_email,'')));
  v_billing text := lower(btrim(coalesce(p_billing_email,'')));
  v_parts text[];
begin
  select * into v_inv from public.company_setup_invitations where id=p_invitation_id for update;
  if not found or v_inv.status<>'pending' or v_inv.expires_at<=now()
     or not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null
       and lower(email)=v_inv.head_email)
     or exists(select 1 from public.organisation_memberships where user_id=v_user)
     or exists(select 1 from public.platform_admins where user_id=v_user) then
    raise exception 'INVITATION_NOT_ELIGIBLE' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 160 or
     length(btrim(coalesce(p_legal_name,''))) not between 1 and 200 or
     length(v_abn)<>11 or not private.valid_abn(v_abn) or
     v_billing !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' or
     v_doc !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' or
     length(v_doc)>320 or length(v_billing)>320 or
     length(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')) not between 10 and 12 or
     (nullif(btrim(coalesce(p_website,'')),'') is not null and p_website !~* '^https?://[^[:space:]]+$') then
    raise exception 'INVALID_COMPANY_DETAILS' using errcode='22023';
  end if;
  insert into public.organisations(name,legal_name,abn,billing_email,contact_phone,website,
    status,head_broker_user_id,identity_locked,identity_verified_at,identity_verified_by)
  values(btrim(p_name),btrim(p_legal_name),v_abn,v_billing,btrim(p_phone),
    nullif(btrim(p_website),''),'active',v_user,true,now(),v_inv.created_by)
  returning id into v_org;
  insert into public.organisation_memberships(organisation_id,user_id,role,status,invited_at,activated_at)
  values(v_org,v_user,'company_admin','active',v_inv.created_at,now()) returning id into v_membership;
  perform set_config('brokerrelay.head_broker_transfer',v_org::text,true);
  insert into public.organisation_member_roles(membership_id,organisation_id,user_id,role,granted_by_user_id)
  values(v_membership,v_org,v_user,'head_broker',v_inv.created_by);
  perform set_config('brokerrelay.head_broker_transfer','',true);
  insert into public.broker_profiles(organisation_id,user_id,broker_code,title,is_active)
  values(v_org,v_user,'BR-'||upper(substr(replace(v_user::text,'-',''),1,8)),'Head Broker',true);
  insert into public.document_delivery_endpoints(organisation_id,user_id,email,endpoint_type,active,verified_at)
  values(v_org,null,v_doc,'company',false,null);
  v_parts := regexp_split_to_array(btrim(v_inv.head_name),'\s+');
  update public.profiles set first_name=v_parts[1],
    last_name=coalesce(nullif(array_to_string(v_parts[2:array_length(v_parts,1)],' '),''),''),
    mobile=v_inv.head_mobile where id=v_user;
  update public.company_setup_invitations set status='completed',completed_at=now(),organisation_id=v_org
  where id=v_inv.id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(v_org,v_user,'company_created','organisation',v_org,
    jsonb_build_object('invitation_id',v_inv.id,'invited_by',v_inv.created_by));
  return v_org;
end $$;

revoke all on function public.platform_list_company_invitations() from public,anon;
revoke all on function public.platform_list_companies() from public,anon;
revoke all on function public.platform_invite_company(text,text,text) from public,anon;
revoke all on function public.platform_cancel_company_invitation(uuid) from public,anon;
revoke all on function public.my_company_setup_invitation() from public,anon;
revoke all on function public.accept_company_setup_invitation(uuid,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.platform_list_company_invitations() to authenticated;
grant execute on function public.platform_list_companies() to authenticated;
grant execute on function public.platform_invite_company(text,text,text) to authenticated;
grant execute on function public.platform_cancel_company_invitation(uuid) to authenticated;
grant execute on function public.my_company_setup_invitation() to authenticated;
grant execute on function public.accept_company_setup_invitation(uuid,text,text,text,text,text,text,text) to authenticated;
-- Close the old owner-created company path; only invitation acceptance may provision a new tenant.
revoke execute on function public.platform_create_company_with_delivery(text,text,text,text,text,text,text,text,text) from authenticated;
notify pgrst,'reload schema';
commit;
