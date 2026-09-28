create table if not exists public.lenders (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lenders_name_length check (char_length(btrim(name)) between 2 and 120)
);
create unique index if not exists lenders_org_name_unique on public.lenders (organisation_id, lower(btrim(name)));
create index if not exists lenders_org_active_idx on public.lenders (organisation_id, active, name);

alter table public.loan_applications add column if not exists lender_id uuid references public.lenders(id);
create index if not exists loan_applications_lender_idx on public.loan_applications (organisation_id, lender_id, client_id) where lender_id is not null;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id),
  audience_type text not null check (audience_type in ('my_clients','all_company','lenders','selected_clients')),
  title text not null,
  body text not null,
  push_requested boolean not null default false,
  status text not null default 'sent' check (status in ('draft','sent','cancelled')),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_length check (char_length(btrim(title)) between 2 and 120),
  constraint announcements_body_length check (char_length(btrim(body)) between 2 and 4000)
);
create index if not exists announcements_org_sent_idx on public.announcements (organisation_id, sent_at desc nulls last);
create index if not exists announcements_sender_idx on public.announcements (sender_user_id, created_at desc);

create table if not exists public.announcement_lenders (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  lender_id uuid not null references public.lenders(id),
  primary key (announcement_id, lender_id)
);

create table if not exists public.announcement_selected_clients (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  primary key (announcement_id, client_id)
);

create table if not exists public.announcement_recipients (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  user_id uuid references auth.users(id),
  notification_id uuid references public.client_notifications(id) on delete set null,
  delivery_state text not null default 'queued' check (delivery_state in ('queued','in_app_created','not_connected','failed')),
  created_at timestamptz not null default now(),
  unique (announcement_id, client_id)
);
create index if not exists announcement_recipients_announcement_idx on public.announcement_recipients (announcement_id, delivery_state);
create index if not exists announcement_recipients_client_idx on public.announcement_recipients (client_id, created_at desc);

alter table public.client_notifications add column if not exists announcement_id uuid references public.announcements(id) on delete set null;
create index if not exists client_notifications_announcement_idx on public.client_notifications (announcement_id) where announcement_id is not null;

alter table public.lenders enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_lenders enable row level security;
alter table public.announcement_selected_clients enable row level security;
alter table public.announcement_recipients enable row level security;

create policy lenders_select_staff on public.lenders for select to authenticated using (
  private.has_org_role(organisation_id, array['company_admin'::public.membership_role,'broker'::public.membership_role,'broker_assistant'::public.membership_role])
);

create policy announcements_select_staff on public.announcements for select to authenticated using (
  sender_user_id = auth.uid() or private.has_org_role(organisation_id, array['company_admin'::public.membership_role])
);

create policy announcement_lenders_select_staff on public.announcement_lenders for select to authenticated using (
  exists (select 1 from public.announcements a where a.id=announcement_id and (a.sender_user_id=auth.uid() or private.has_org_role(a.organisation_id,array['company_admin'::public.membership_role])))
);

create policy announcement_selected_clients_select_staff on public.announcement_selected_clients for select to authenticated using (
  exists (select 1 from public.announcements a where a.id=announcement_id and (a.sender_user_id=auth.uid() or private.has_org_role(a.organisation_id,array['company_admin'::public.membership_role])))
);

create policy announcement_recipients_select_staff on public.announcement_recipients for select to authenticated using (
  exists (select 1 from public.announcements a where a.id=announcement_id and (a.sender_user_id=auth.uid() or private.has_org_role(a.organisation_id,array['company_admin'::public.membership_role])))
);

create or replace function private.can_use_announcement_tools(p_organisation_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.has_org_role(
    p_organisation_id,
    array['company_admin'::public.membership_role,'broker'::public.membership_role]
  );
$$;
revoke all on function private.can_use_announcement_tools(uuid) from public;
grant execute on function private.can_use_announcement_tools(uuid) to authenticated;

create or replace function private.resolve_announcement_audience(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_audience_type text,
  p_lender_ids uuid[] default null,
  p_client_ids uuid[] default null
)
returns table(client_id uuid, user_id uuid, first_name text, last_name text, email text)
language plpgsql security definer set search_path='' as $$
begin
  if p_audience_type not in ('my_clients','all_company','lenders','selected_clients') then
    raise exception 'Invalid announcement audience';
  end if;

  if p_audience_type='all_company' and not private.has_org_role(p_organisation_id,array['company_admin'::public.membership_role]) then
    raise exception 'Only a company admin can announce to all company clients';
  end if;

  return query
  with eligible as (
    select distinct c.id, c.user_id, c.first_name, c.last_name, c.email
    from public.clients c
    where c.organisation_id=p_organisation_id
      and c.status='active'
      and c.archived_at is null
      and (
        (p_audience_type='all_company')
        or
        (p_audience_type='my_clients' and exists (
          select 1 from public.client_assignments ca
          where ca.client_id=c.id and ca.organisation_id=p_organisation_id and ca.member_user_id=p_actor_user_id
        ))
        or
        (p_audience_type='selected_clients'
          and c.id=any(coalesce(p_client_ids,array[]::uuid[]))
          and (
            private.has_org_role(p_organisation_id,array['company_admin'::public.membership_role])
            or exists (
              select 1 from public.client_assignments ca
              where ca.client_id=c.id and ca.organisation_id=p_organisation_id and ca.member_user_id=p_actor_user_id
            )
          )
        )
        or
        (p_audience_type='lenders'
          and exists (
            select 1
            from public.loan_applications la
            where la.client_id=c.id
              and la.organisation_id=p_organisation_id
              and la.lender_id=any(coalesce(p_lender_ids,array[]::uuid[]))
              and la.status <> 'withdrawn'
          )
          and (
            private.has_org_role(p_organisation_id,array['company_admin'::public.membership_role])
            or exists (
              select 1 from public.client_assignments ca
              where ca.client_id=c.id and ca.organisation_id=p_organisation_id and ca.member_user_id=p_actor_user_id
            )
          )
        )
      )
  )
  select e.id,e.user_id,e.first_name,e.last_name,e.email from eligible e order by e.first_name,e.last_name;
end;
$$;
revoke all on function private.resolve_announcement_audience(uuid,uuid,text,uuid[],uuid[]) from public;

create or replace function public.add_lender(p_organisation_id uuid,p_name text)
returns table(lender_id uuid,lender_name text)
language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_name text:=nullif(btrim(p_name),'');
  v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.can_use_announcement_tools(p_organisation_id) then raise exception 'You do not have access to manage lenders'; end if;
  if v_name is null or length(v_name)<2 or length(v_name)>120 then raise exception 'Lender name must be between 2 and 120 characters'; end if;

  insert into public.lenders(organisation_id,name,created_by_user_id)
  values(p_organisation_id,v_name,v_user)
  on conflict (organisation_id,lower(btrim(name))) do update set active=true,updated_at=now()
  returning id,name into v_id,v_name;

  return query select v_id,v_name;
end;
$$;
revoke all on function public.add_lender(uuid,text) from public,anon;
grant execute on function public.add_lender(uuid,text) to authenticated;

create or replace function public.set_application_lender(p_application_id uuid,p_lender_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_org uuid;
  v_client uuid;
  v_lender_org uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select organisation_id,client_id into v_org,v_client from public.loan_applications where id=p_application_id for update;
  if v_org is null or not private.can_manage_loan_application(v_org,v_client) then raise exception 'You do not have access to update this application'; end if;
  if p_lender_id is not null then
    select organisation_id into v_lender_org from public.lenders where id=p_lender_id and active=true;
    if v_lender_org is distinct from v_org then raise exception 'Selected lender is not available to this organisation'; end if;
  end if;
  update public.loan_applications set lender_id=p_lender_id,updated_at=now() where id=p_application_id;
  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(v_org,v_user,'loan_application_lender_updated','loan_application',p_application_id,jsonb_build_object('client_id',v_client,'lender_id',p_lender_id));
end;
$$;
revoke all on function public.set_application_lender(uuid,uuid) from public,anon;
grant execute on function public.set_application_lender(uuid,uuid) to authenticated;

create or replace function public.preview_announcement_audience(
  p_organisation_id uuid,
  p_audience_type text,
  p_lender_ids uuid[] default null,
  p_client_ids uuid[] default null
)
returns table(client_id uuid,client_name text,email text,connected boolean)
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.can_use_announcement_tools(p_organisation_id) then raise exception 'You do not have access to announcements'; end if;
  return query
  select r.client_id,btrim(r.first_name||' '||r.last_name),r.email,(r.user_id is not null)
  from private.resolve_announcement_audience(v_user,p_organisation_id,p_audience_type,p_lender_ids,p_client_ids) r;
end;
$$;
revoke all on function public.preview_announcement_audience(uuid,text,uuid[],uuid[]) from public,anon;
grant execute on function public.preview_announcement_audience(uuid,text,uuid[],uuid[]) to authenticated;

create or replace function public.send_announcement(
  p_organisation_id uuid,
  p_audience_type text,
  p_title text,
  p_body text,
  p_push_requested boolean default false,
  p_lender_ids uuid[] default null,
  p_client_ids uuid[] default null
)
returns table(announcement_id uuid,recipient_count integer,connected_count integer)
language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_title text:=nullif(btrim(p_title),'');
  v_body text:=nullif(btrim(p_body),'');
  v_announcement uuid;
  v_total integer:=0;
  v_connected integer:=0;
  r record;
  v_notification uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.can_use_announcement_tools(p_organisation_id) then raise exception 'You do not have access to announcements'; end if;
  if v_title is null or length(v_title)>120 then raise exception 'Announcement title is required and must be 120 characters or less'; end if;
  if v_body is null or length(v_body)>4000 then raise exception 'Announcement message is required and must be 4000 characters or less'; end if;

  create temporary table if not exists pg_temp.aidez_announcement_audience(
    client_id uuid,user_id uuid,first_name text,last_name text,email text
  ) on commit drop;
  truncate pg_temp.aidez_announcement_audience;
  insert into pg_temp.aidez_announcement_audience
  select * from private.resolve_announcement_audience(v_user,p_organisation_id,p_audience_type,p_lender_ids,p_client_ids);

  select count(*) into v_total from pg_temp.aidez_announcement_audience;
  if v_total=0 then raise exception 'No clients match this audience'; end if;

  insert into public.announcements(organisation_id,sender_user_id,audience_type,title,body,push_requested,status,recipient_count,sent_at)
  values(p_organisation_id,v_user,p_audience_type,v_title,v_body,coalesce(p_push_requested,false),'sent',v_total,now())
  returning id into v_announcement;

  if p_audience_type='lenders' then
    insert into public.announcement_lenders(announcement_id,lender_id)
    select v_announcement,x from unnest(coalesce(p_lender_ids,array[]::uuid[])) x
    join public.lenders l on l.id=x and l.organisation_id=p_organisation_id
    on conflict do nothing;
  elsif p_audience_type='selected_clients' then
    insert into public.announcement_selected_clients(announcement_id,client_id)
    select v_announcement,aa.client_id from pg_temp.aidez_announcement_audience aa on conflict do nothing;
  end if;

  for r in select * from pg_temp.aidez_announcement_audience loop
    v_notification:=null;
    if r.user_id is not null then
      insert into public.client_notifications(
        organisation_id,client_id,user_id,application_id,announcement_id,notification_type,title,body,data,push_eligible
      ) values(
        p_organisation_id,r.client_id,r.user_id,null,v_announcement,'announcement',v_title,
        replace(v_body,'{{client_first_name}}',coalesce(r.first_name,'')),
        jsonb_build_object('announcement_id',v_announcement,'audience_type',p_audience_type),coalesce(p_push_requested,false)
      ) returning id into v_notification;
      v_connected:=v_connected+1;
    end if;

    insert into public.announcement_recipients(announcement_id,organisation_id,client_id,user_id,notification_id,delivery_state)
    values(v_announcement,p_organisation_id,r.client_id,r.user_id,v_notification,case when r.user_id is null then 'not_connected' else 'in_app_created' end);
  end loop;

  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(p_organisation_id,v_user,'announcement_sent','announcement',v_announcement,
    jsonb_build_object('audience_type',p_audience_type,'recipient_count',v_total,'connected_count',v_connected,'push_requested',coalesce(p_push_requested,false)));

  return query select v_announcement,v_total,v_connected;
end;
$$;
revoke all on function public.send_announcement(uuid,text,text,text,boolean,uuid[],uuid[]) from public,anon;
grant execute on function public.send_announcement(uuid,text,text,text,boolean,uuid[],uuid[]) to authenticated;

create or replace function public.get_my_announcement(p_announcement_id uuid)
returns table(announcement_id uuid,title text,body text,sender_name text,sent_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  return query
  select a.id,a.title,replace(a.body,'{{client_first_name}}',coalesce(c.first_name,'')),btrim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),a.sent_at
  from public.announcements a
  join public.announcement_recipients ar on ar.announcement_id=a.id and ar.user_id=v_user
  join public.clients c on c.id=ar.client_id
  left join public.profiles p on p.id=a.sender_user_id
  where a.id=p_announcement_id;
end;
$$;
revoke all on function public.get_my_announcement(uuid) from public,anon;
grant execute on function public.get_my_announcement(uuid) to authenticated;

grant select on public.lenders,public.announcements,public.announcement_lenders,public.announcement_selected_clients,public.announcement_recipients to authenticated;;
