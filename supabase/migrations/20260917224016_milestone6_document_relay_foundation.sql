
create table if not exists public.document_delivery_endpoints (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  endpoint_type text not null default 'broker'
    check (endpoint_type in ('broker','company')),
  active boolean not null default true,
  verified_at timestamptz,
  verification_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists document_delivery_endpoints_active_user_idx
  on public.document_delivery_endpoints (organisation_id, user_id)
  where active and user_id is not null;

create table if not exists public.document_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  application_id uuid references public.loan_applications(id) on delete set null,
  requested_by_user_id uuid not null references auth.users(id),
  document_type text,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  description text check (description is null or char_length(description) <= 1500),
  status text not null default 'requested'
    check (status in ('requested','upload_in_progress','relay_processing','relayed','failed','cancelled')),
  delivery_endpoint_id uuid references public.document_delivery_endpoints(id) on delete set null,
  delivery_email_snapshot text not null,
  max_files integer not null default 1 check (max_files between 1 and 10),
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists document_requests_client_created_idx
  on public.document_requests (client_id, requested_at desc);
create index if not exists document_requests_org_status_idx
  on public.document_requests (organisation_id, status, requested_at desc);
create index if not exists document_requests_application_idx
  on public.document_requests (application_id) where application_id is not null;

create table if not exists public.document_upload_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  document_request_id uuid not null references public.document_requests(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  storage_object_path text not null unique,
  original_file_name text,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  state text not null default 'ticket_created'
    check (state in ('ticket_created','uploaded','validating','relay_processing','relayed','failed','purged')),
  expires_at timestamptz not null,
  uploaded_at timestamptz,
  relayed_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_upload_items_request_idx
  on public.document_upload_items (document_request_id, created_at);
create index if not exists document_upload_items_expiry_idx
  on public.document_upload_items (state, expires_at)
  where state not in ('purged','relayed');

create table if not exists public.document_transfer_events (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  document_request_id uuid not null references public.document_requests(id) on delete cascade,
  upload_item_id uuid references public.document_upload_items(id) on delete set null,
  actor_user_id uuid references auth.users(id),
  event_type text not null check (event_type in (
    'request_created','upload_ticket_created','upload_started','upload_completed',
    'validation_passed','validation_failed','scan_passed','scan_failed',
    'relay_started','relay_accepted','relay_failed','purge_completed','request_cancelled'
  )),
  file_name_sanitised text,
  content_type text,
  size_bytes bigint,
  provider_message_id text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists document_transfer_events_request_idx
  on public.document_transfer_events (document_request_id, created_at);

alter table public.document_delivery_endpoints enable row level security;
alter table public.document_requests enable row level security;
alter table public.document_upload_items enable row level security;
alter table public.document_transfer_events enable row level security;

create or replace function private.can_access_document_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.document_requests dr
    join public.clients c on c.id=dr.client_id and c.organisation_id=dr.organisation_id
    where dr.id=p_request_id
      and (
        c.user_id=(select auth.uid())
        or private.can_manage_loan_application(dr.organisation_id,dr.client_id)
      )
  );
$$;

revoke all on function private.can_access_document_request(uuid) from public, anon, authenticated;

drop policy if exists document_requests_select_allowed on public.document_requests;
create policy document_requests_select_allowed
on public.document_requests for select
to authenticated
using (
  exists (
    select 1
    from public.clients c
    where c.id=document_requests.client_id
      and c.organisation_id=document_requests.organisation_id
      and c.user_id=(select auth.uid())
  )
  or private.can_manage_loan_application(document_requests.organisation_id,document_requests.client_id)
);

drop policy if exists document_delivery_endpoints_select_own on public.document_delivery_endpoints;
create policy document_delivery_endpoints_select_own
on public.document_delivery_endpoints for select
to authenticated
using (
  user_id=(select auth.uid())
  or private.has_org_role(
    organisation_id,
    array['company_admin'::public.membership_role]
  )
);

-- No direct client/storage-object policies are created for document_upload_items.
-- Upload object paths and transfer internals are server-only.

revoke insert, update, delete on public.document_delivery_endpoints from anon, authenticated;
revoke insert, update, delete on public.document_requests from anon, authenticated;
revoke all on public.document_upload_items from anon, authenticated;
revoke all on public.document_transfer_events from anon, authenticated;
grant select on public.document_delivery_endpoints to authenticated;
grant select on public.document_requests to authenticated;

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

  select nullif(btrim(bp.contact_email),'')
    into v_email
  from public.broker_profiles bp
  where bp.organisation_id=v_org
    and bp.user_id=v_user
    and bp.is_active
  limit 1;

  if v_email is null then
    raise exception 'Set your broker contact email before requesting documents';
  end if;

  insert into public.document_requests(
    organisation_id,client_id,application_id,requested_by_user_id,
    document_type,title,description,status,delivery_email_snapshot,max_files
  ) values(
    v_org,p_client_id,p_application_id,v_user,
    v_type,v_title,v_description,'requested',v_email,v_max_files
  ) returning id into v_request;

  insert into public.document_transfer_events(
    organisation_id,document_request_id,actor_user_id,event_type,metadata
  ) values(
    v_org,v_request,v_user,'request_created',
    jsonb_build_object(
      'application_number',v_app_ref,
      'max_files',v_max_files
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
      'max_files',v_max_files
    )
  );

  return v_request;
end;
$$;

create or replace function public.cancel_document_request(p_document_request_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_req public.document_requests%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_req
  from public.document_requests
  where id=p_document_request_id
  for update;

  if v_req.id is null or not private.can_manage_loan_application(v_req.organisation_id,v_req.client_id) then
    raise exception 'You do not have access to this document request';
  end if;
  if v_req.status in ('relayed','cancelled') then
    raise exception 'This document request cannot be cancelled';
  end if;

  update public.document_requests
  set status='cancelled',cancelled_at=now(),updated_at=now()
  where id=p_document_request_id;

  insert into public.document_transfer_events(
    organisation_id,document_request_id,actor_user_id,event_type
  ) values(v_req.organisation_id,v_req.id,v_user,'request_cancelled');

  insert into public.audit_events(
    organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata
  ) values(
    v_req.organisation_id,v_user,'document_request_cancelled',
    'document_request',v_req.id,'{}'::jsonb
  );
end;
$$;

create or replace function public.list_document_requests_for_client(p_client_id uuid)
returns table(
  document_request_id uuid,
  application_id uuid,
  application_number text,
  application_description text,
  document_type text,
  title text,
  description text,
  status text,
  max_files integer,
  requested_at timestamptz,
  fulfilled_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_org uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select c.organisation_id into v_org
  from public.clients c
  where c.id=p_client_id
    and (
      c.user_id=v_user
      or private.can_manage_loan_application(c.organisation_id,c.id)
    );

  if v_org is null then raise exception 'You do not have access to this client'; end if;

  return query
  select dr.id,dr.application_id,la.application_reference,la.application_description,
         dr.document_type,dr.title,dr.description,dr.status,dr.max_files,
         dr.requested_at,dr.fulfilled_at
  from public.document_requests dr
  left join public.loan_applications la on la.id=dr.application_id
  where dr.client_id=p_client_id and dr.organisation_id=v_org
  order by dr.requested_at desc;
end;
$$;

create or replace function public.get_my_document_requests()
returns table(
  document_request_id uuid,
  client_id uuid,
  application_id uuid,
  application_number text,
  application_description text,
  document_type text,
  title text,
  description text,
  status text,
  max_files integer,
  requested_at timestamptz,
  fulfilled_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  return query
  select dr.id,dr.client_id,dr.application_id,la.application_reference,la.application_description,
         dr.document_type,dr.title,dr.description,dr.status,dr.max_files,
         dr.requested_at,dr.fulfilled_at
  from public.document_requests dr
  join public.clients c on c.id=dr.client_id and c.organisation_id=dr.organisation_id
  left join public.loan_applications la on la.id=dr.application_id
  where c.user_id=v_user
  order by dr.requested_at desc;
end;
$$;

revoke all on function public.create_document_request(uuid,uuid,text,text,text,integer) from public,anon;
revoke all on function public.cancel_document_request(uuid) from public,anon;
revoke all on function public.list_document_requests_for_client(uuid) from public,anon;
revoke all on function public.get_my_document_requests() from public,anon;
grant execute on function public.create_document_request(uuid,uuid,text,text,text,integer) to authenticated;
grant execute on function public.cancel_document_request(uuid) to authenticated;
grant execute on function public.list_document_requests_for_client(uuid) to authenticated;
grant execute on function public.get_my_document_requests() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'mortgage-document-relay',
  'mortgage-document-relay',
  false,
  15728640,
  array['application/pdf','image/jpeg','image/png','image/heic','image/heif']::text[]
)
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types,
    updated_at=now();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='document_requests'
  ) then
    alter publication supabase_realtime add table public.document_requests;
  end if;
end $$;
;
