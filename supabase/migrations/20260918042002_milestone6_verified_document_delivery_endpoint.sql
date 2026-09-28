
alter table public.document_delivery_endpoints
  drop constraint if exists document_delivery_endpoints_email_nonblank;
alter table public.document_delivery_endpoints
  add constraint document_delivery_endpoints_email_nonblank
  check (char_length(btrim(email)) between 3 and 320);

create index if not exists document_delivery_endpoints_org_active_idx
  on public.document_delivery_endpoints(organisation_id,active);

create or replace function public.get_my_document_delivery_endpoint()
returns table(
  endpoint_id uuid,
  email text,
  endpoint_type text,
  verified boolean,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  return query
  select dde.id,dde.email,dde.endpoint_type,(dde.verified_at is not null),dde.verified_at
  from public.document_delivery_endpoints dde
  where dde.user_id=v_user
    and dde.active
    and exists (
      select 1 from public.organisation_memberships om
      where om.organisation_id=dde.organisation_id
        and om.user_id=v_user
        and om.status='active'
    )
  order by dde.verified_at desc nulls last,dde.created_at desc
  limit 1;
end;
$$;

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
    and dde.user_id=v_user
    and dde.active
    and dde.verified_at is not null
  order by dde.verified_at desc,dde.created_at desc
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

revoke all on function public.get_my_document_delivery_endpoint() from public,anon;
grant execute on function public.get_my_document_delivery_endpoint() to authenticated;
revoke all on function public.create_document_request(uuid,uuid,text,text,text,integer) from public,anon;
grant execute on function public.create_document_request(uuid,uuid,text,text,text,integer) to authenticated;
;
