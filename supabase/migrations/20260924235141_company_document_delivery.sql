begin;

-- Pending delivery addresses are inert until mailbox ownership is proved.
create table if not exists private.company_document_email_challenges (
  endpoint_id uuid primary key references public.document_delivery_endpoints(id) on delete cascade,
  token_digest bytea not null,
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts between 0 and 5)
);
alter table private.company_document_email_challenges enable row level security;
revoke all on private.company_document_email_challenges from public,anon,authenticated;

create index if not exists document_delivery_company_current_idx
on public.document_delivery_endpoints(organisation_id,verified_at desc)
where endpoint_type='company' and user_id is null;

-- The existing platform creation function remains the source of all owner/head-broker checks.
-- Its direct grant is removed so every new company must supply a delivery mailbox.
create or replace function public.platform_create_company_with_delivery(
  p_name text, p_legal_name text, p_abn text, p_billing_email text,
  p_head_broker_email text, p_document_delivery_email text,
  p_contact_phone text default null, p_website text default null,
  p_broker_code text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_email text := lower(btrim(coalesce(p_document_delivery_email,'')));
begin
  if v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' or length(v_email)>320 then
    raise exception 'INVALID_DOCUMENT_DELIVERY_EMAIL' using errcode='22023';
  end if;
  v_org := public.platform_create_company(
    p_name,p_legal_name,p_abn,p_billing_email,p_head_broker_email,
    p_contact_phone,p_website,p_broker_code
  );
  insert into public.document_delivery_endpoints
    (organisation_id,user_id,email,endpoint_type,active,verified_at)
  values (v_org,null,v_email,'company',false,null);
  return v_org;
end $$;
revoke all on function public.platform_create_company_with_delivery(text,text,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.platform_create_company_with_delivery(text,text,text,text,text,text,text,text,text) to authenticated;
revoke execute on function public.platform_create_company(text,text,text,text,text,text,text,text) from authenticated;

-- Existing companies: only their Head Broker may propose a delivery destination.
create or replace function public.propose_company_document_email(p_organisation_id uuid,p_email text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_email text := lower(btrim(coalesce(p_email,''))); v_id uuid;
begin
  if not private.is_head_broker(p_organisation_id,(select auth.uid())) then
    raise exception 'HEAD_BROKER_REQUIRED' using errcode='42501';
  end if;
  if v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' or length(v_email)>320 then
    raise exception 'INVALID_DOCUMENT_DELIVERY_EMAIL' using errcode='22023';
  end if;
  -- A replacement cannot silently redirect open requests. They retain their original endpoint.
  delete from public.document_delivery_endpoints
  where organisation_id=p_organisation_id and endpoint_type='company'
    and user_id is null and verified_at is null;
  insert into public.document_delivery_endpoints
    (organisation_id,user_id,email,endpoint_type,active,verified_at)
  values(p_organisation_id,null,v_email,'company',false,null)
  returning id into v_id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organisation_id,(select auth.uid()),'document_email_proposed','document_delivery_endpoint',v_id,
    jsonb_build_object('endpoint_type','company'));
  return v_id;
end $$;
revoke all on function public.propose_company_document_email(uuid,text) from public,anon;
grant execute on function public.propose_company_document_email(uuid,text) to authenticated;

create or replace function public.get_company_document_email_status(p_organisation_id uuid)
returns table(email text,verified boolean,pending boolean)
language sql stable security definer set search_path='' as $$
  select e.email,e.verified_at is not null,e.verified_at is null
  from public.document_delivery_endpoints e
  where e.organisation_id=p_organisation_id and e.endpoint_type='company' and e.user_id is null
    and private.is_head_broker(p_organisation_id,(select auth.uid()))
  order by (e.verified_at is null) desc,e.verified_at desc nulls last,e.created_at desc
  limit 2;
$$;
revoke all on function public.get_company_document_email_status(uuid) from public,anon;
grant execute on function public.get_company_document_email_status(uuid) to authenticated;

-- Only the trusted relay function can issue a challenge; this RPC is never callable by a browser.
create or replace function public.issue_company_document_email_code(p_organisation_id uuid)
returns table(email text,code text,company_name text)
language plpgsql security definer set search_path='' as $$
declare v_endpoint uuid; v_email text; v_name text; v_bytes bytea; v_code text; v_last timestamptz;
begin
  select e.id,e.email,o.name into v_endpoint,v_email,v_name
  from public.document_delivery_endpoints e join public.organisations o on o.id=e.organisation_id
  where e.organisation_id=p_organisation_id and e.endpoint_type='company' and e.user_id is null
    and e.verified_at is null and not e.active
  order by e.created_at desc,e.id desc limit 1 for update of e;
  if v_endpoint is null then raise exception 'PENDING_DELIVERY_EMAIL_REQUIRED' using errcode='P0002'; end if;
  select c.sent_at into v_last from private.company_document_email_challenges c where c.endpoint_id=v_endpoint;
  if v_last > now()-interval '60 seconds' then
    raise exception 'WAIT_BEFORE_RESENDING' using errcode='P0001';
  end if;
  v_bytes := extensions.gen_random_bytes(4);
  v_code := lpad(((get_byte(v_bytes,0)::bigint*16777216+
    get_byte(v_bytes,1)::bigint*65536+get_byte(v_bytes,2)::bigint*256+
    get_byte(v_bytes,3)::bigint) % 100000000)::text,8,'0');
  insert into private.company_document_email_challenges(endpoint_id,token_digest,expires_at,sent_at,attempts)
  values(v_endpoint,extensions.digest(v_code,'sha256'),now()+interval '15 minutes',now(),0)
  on conflict(endpoint_id) do update set token_digest=excluded.token_digest,
    expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0;
  email := v_email; code := v_code; company_name := v_name;
  return next;
end $$;
revoke all on function public.issue_company_document_email_code(uuid) from public,anon,authenticated;
grant execute on function public.issue_company_document_email_code(uuid) to service_role;

create or replace function public.confirm_company_document_email(p_organisation_id uuid,p_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_endpoint uuid; v_digest bytea; v_expires timestamptz; v_attempts integer;
begin
  if not private.is_head_broker(p_organisation_id,(select auth.uid())) then
    raise exception 'HEAD_BROKER_REQUIRED' using errcode='42501';
  end if;
  select e.id,c.token_digest,c.expires_at,c.attempts
  into v_endpoint,v_digest,v_expires,v_attempts
  from public.document_delivery_endpoints e
  join private.company_document_email_challenges c on c.endpoint_id=e.id
  where e.organisation_id=p_organisation_id and e.endpoint_type='company'
    and e.user_id is null and e.verified_at is null
  order by e.created_at desc,e.id desc limit 1 for update of c;
  if v_endpoint is null or v_expires<=now() or v_attempts>=5 then return false; end if;
  update private.company_document_email_challenges set attempts=attempts+1 where endpoint_id=v_endpoint;
  if p_code is null or p_code !~ '^[0-9]{8}$' or extensions.digest(p_code,'sha256')<>v_digest then return false; end if;
  update public.document_delivery_endpoints set active=true,verified_at=now(),
    verification_method='email_code',updated_at=now() where id=v_endpoint;
  delete from private.company_document_email_challenges where endpoint_id=v_endpoint;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organisation_id,(select auth.uid()),'document_email_verified','document_delivery_endpoint',v_endpoint,
    jsonb_build_object('verification_method','email_code'));
  return true;
end $$;
revoke all on function public.confirm_company_document_email(uuid,text) from public,anon;
grant execute on function public.confirm_company_document_email(uuid,text) to authenticated;

-- A broker's verified personal address takes precedence; otherwise use the company's verified mailbox.
create or replace function public.get_my_document_delivery_endpoint()
returns table(endpoint_id uuid,email text,endpoint_type text,verified boolean,verified_at timestamptz)
language sql stable security definer set search_path='' as $$
  select e.id,e.email,e.endpoint_type,(e.verified_at is not null),e.verified_at
  from public.document_delivery_endpoints e
  join public.organisation_memberships m on m.organisation_id=e.organisation_id
    and m.user_id=(select auth.uid()) and m.status='active' and m.removed_at is null
  join public.organisations o on o.id=e.organisation_id and o.status in ('trial','active')
  where e.active and e.verified_at is not null and (e.user_id=(select auth.uid()) or
    (e.endpoint_type='company' and e.user_id is null))
  order by (e.user_id=(select auth.uid())) desc,e.verified_at desc nulls last,e.created_at desc
  limit 1;
$$;
revoke all on function public.get_my_document_delivery_endpoint() from public,anon;
grant execute on function public.get_my_document_delivery_endpoint() to authenticated;

-- Preserve the existing request validation, assignment checks, notification, and audit behavior.
-- The full function definition below is generated from the deployed M6 definition with only
-- the endpoint predicate/priority changed; see verification/diff-notes.md.
create or replace function public.create_document_request(
  p_client_id uuid,
  p_application_id uuid default null,
  p_title text default null,
  p_description text default null,
  p_document_type text default null,
  p_max_files integer default 1
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_client_user uuid;
  v_email text;
  v_endpoint uuid;
  v_request uuid;
  v_app_ref text;
  v_title text := nullif(btrim(p_title),'');
  v_description text := nullif(btrim(p_description),'');
  v_type text := nullif(btrim(p_document_type),'');
  v_max_files integer := coalesce(p_max_files,1);
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_title is null or char_length(v_title)>120 then
    raise exception 'Request title is required and must be 120 characters or less';
  end if;
  if v_description is not null and char_length(v_description)>1500 then
    raise exception 'Description must be 1500 characters or less';
  end if;
  if v_max_files < 1 or v_max_files > 10 then
    raise exception 'Maximum files must be between 1 and 10';
  end if;

  select c.organisation_id,c.user_id
    into v_org,v_client_user
  from public.clients c
  where c.id=p_client_id and c.status='active' and c.archived_at is null;

  if v_org is null or not private.can_manage_loan_application(v_org,p_client_id) then
    raise exception 'You do not have access to this client';
  end if;

  if p_application_id is not null then
    select la.application_reference
      into v_app_ref
    from public.loan_applications la
    where la.id=p_application_id
      and la.organisation_id=v_org
      and la.client_id=p_client_id
      and la.status <> 'withdrawn';

    if not found then
      raise exception 'Application is not available for this document request';
    end if;
  end if;

  select dde.id,dde.email
    into v_endpoint,v_email
  from public.document_delivery_endpoints dde
  where dde.organisation_id=v_org
    and (dde.user_id=v_user or (dde.endpoint_type='company' and dde.user_id is null))
    and dde.active
    and dde.verified_at is not null
  order by (dde.user_id=v_user) desc,dde.verified_at desc,dde.created_at desc
  limit 1;

  if v_endpoint is null or v_email is null then
    raise exception 'A verified Document Delivery Email is required before requesting documents';
  end if;

  insert into public.document_requests(
    organisation_id,client_id,application_id,requested_by_user_id,
    document_type,title,description,status,delivery_endpoint_id,
    delivery_email_snapshot,max_files
  ) values(
    v_org,p_client_id,p_application_id,v_user,
    v_type,v_title,v_description,'requested',v_endpoint,
    v_email,v_max_files
  ) returning id into v_request;

  insert into public.document_transfer_events(
    organisation_id,document_request_id,actor_user_id,event_type,metadata
  ) values(
    v_org,v_request,v_user,'request_created',
    jsonb_build_object(
      'application_number',v_app_ref,
      'max_files',v_max_files,
      'delivery_endpoint_id',v_endpoint
    )
  );

  if v_client_user is not null then
    insert into public.client_notifications(
      organisation_id,client_id,user_id,application_id,
      notification_type,title,body,data,push_eligible
    ) values(
      v_org,p_client_id,v_client_user,p_application_id,
      'document_request','Document requested',
      'Your broker has requested: '||v_title||'.',
      jsonb_build_object('document_request_id',v_request),
      true
    );
  end if;

  insert into public.audit_events(
    organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata
  ) values(
    v_org,v_user,'document_request_created','document_request',v_request,
    jsonb_build_object(
      'client_id',p_client_id,
      'application_id',p_application_id,
      'application_number',v_app_ref,
      'max_files',v_max_files,
      'delivery_endpoint_id',v_endpoint
    )
  );

  return v_request;
end;
$$;

revoke all on function public.create_document_request(uuid,uuid,text,text,text,integer) from public,anon;
grant execute on function public.create_document_request(uuid,uuid,text,text,text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
