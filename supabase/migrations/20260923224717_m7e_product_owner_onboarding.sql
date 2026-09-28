begin;

create or replace function public.platform_create_initial_company(
  p_name text,
  p_legal_name text,
  p_abn text,
  p_billing_email text,
  p_contact_phone text default null,
  p_website text default null,
  p_broker_code text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_org_id uuid;
  v_membership_id uuid;
  v_abn text := regexp_replace(coalesce(p_abn,''),'[^0-9]','','g');
  v_phone text := nullif(trim(p_contact_phone),'');
  v_website text := nullif(trim(p_website),'');
begin
  if v_user_id is null or not private.is_platform_admin() then
    raise exception 'PLATFORM_ADMIN_REQUIRED' using errcode='42501';
  end if;
  if exists(select 1 from public.organisation_memberships where user_id=v_user_id and removed_at is null) then
    raise exception 'PRODUCT_OWNER_ALREADY_HAS_A_COMPANY' using errcode='23505';
  end if;
  if nullif(trim(p_name),'') is null or length(trim(p_name))>160 then raise exception 'INVALID_COMPANY_NAME' using errcode='22023'; end if;
  if nullif(trim(p_legal_name),'') is null or length(trim(p_legal_name))>200 then raise exception 'INVALID_LEGAL_NAME' using errcode='22023'; end if;
  if not private.valid_abn(v_abn) then raise exception 'INVALID_ABN' using errcode='22023'; end if;
  if nullif(trim(p_billing_email),'') is null or trim(p_billing_email)!~*'^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'INVALID_BILLING_EMAIL' using errcode='22023';
  end if;
  if v_phone is not null and (v_phone!~'^[+()0-9[:space:]\-]+$'
     or not ((length(regexp_replace(v_phone,'[^0-9]','','g'))=10 and regexp_replace(v_phone,'[^0-9]','','g') like '0%')
       or (length(regexp_replace(v_phone,'[^0-9]','','g'))=11 and regexp_replace(v_phone,'[^0-9]','','g') like '61%'))) then
    raise exception 'INVALID_PHONE' using errcode='22023';
  end if;
  if v_website is not null and v_website!~*'^https?://[^[:space:]]+$' then raise exception 'INVALID_WEBSITE' using errcode='22023'; end if;

  insert into public.organisations(
    name,legal_name,abn,billing_email,contact_phone,website,status,
    head_broker_user_id,identity_locked,identity_verified_at,identity_verified_by
  ) values (
    trim(p_name),trim(p_legal_name),v_abn,lower(trim(p_billing_email)),v_phone,v_website,'active',
    v_user_id,true,now(),v_user_id
  ) returning id into v_org_id;

  insert into public.organisation_memberships(
    organisation_id,user_id,role,status,invited_at,activated_at
  ) values (v_org_id,v_user_id,'company_admin','active',now(),now())
  returning id into v_membership_id;

  perform set_config('brokerrelay.head_broker_transfer',v_org_id::text,true);
  insert into public.organisation_member_roles(
    membership_id,organisation_id,user_id,role,granted_by_user_id
  ) values (v_membership_id,v_org_id,v_user_id,'head_broker',v_user_id);
  perform set_config('brokerrelay.head_broker_transfer','',true);

  insert into public.broker_profiles(organisation_id,user_id,broker_code,title,is_active)
  values(v_org_id,v_user_id,coalesce(nullif(trim(p_broker_code),''),'BR-'||upper(substr(replace(v_user_id::text,'-',''),1,8))),'Head Broker',true);

  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(v_org_id,v_user_id,'initial_company_created','organisation',v_org_id,jsonb_build_object('head_broker_user_id',v_user_id));
  return v_org_id;
end $$;

revoke all on function public.platform_create_initial_company(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.platform_create_initial_company(text,text,text,text,text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
