create table if not exists public.announcement_company_authorisers (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_send_company_announcements boolean not null default true,
  granted_by_user_id uuid null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organisation_id,user_id)
);

alter table public.announcement_company_authorisers enable row level security;
revoke all on public.announcement_company_authorisers from anon, authenticated;

-- Seed the current organisation owners/admins once. Future companies and delegations
-- will be managed explicitly by the Admin module rather than inferred from role.
insert into public.announcement_company_authorisers(organisation_id,user_id,can_send_company_announcements,granted_by_user_id)
select om.organisation_id,om.user_id,true,om.user_id
from public.organisation_memberships om
where om.role='company_admin' and om.status='active'
on conflict (organisation_id,user_id) do nothing;

create index if not exists announcement_company_authorisers_user_idx
  on public.announcement_company_authorisers(user_id,organisation_id);
create index if not exists announcement_lenders_lender_fk_idx
  on public.announcement_lenders(lender_id);
create index if not exists announcement_selected_clients_client_fk_idx
  on public.announcement_selected_clients(client_id);
create index if not exists announcement_recipients_org_fk_idx
  on public.announcement_recipients(organisation_id);
create index if not exists announcement_recipients_user_fk_idx
  on public.announcement_recipients(user_id) where user_id is not null;
create index if not exists announcement_recipients_notification_fk_idx
  on public.announcement_recipients(notification_id) where notification_id is not null;
create index if not exists lenders_created_by_fk_idx
  on public.lenders(created_by_user_id) where created_by_user_id is not null;
create index if not exists loan_applications_lender_fk_idx
  on public.loan_applications(lender_id) where lender_id is not null;

create or replace function private.can_send_company_announcements(
  p_organisation_id uuid,
  p_user_id uuid default auth.uid()
) returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.announcement_company_authorisers aca
    where aca.organisation_id=p_organisation_id
      and aca.user_id=p_user_id
      and aca.can_send_company_announcements=true
  );
$$;

revoke all on function private.can_send_company_announcements(uuid,uuid) from public, anon, authenticated;

create or replace function public.get_announcement_permissions(p_organisation_id uuid)
returns table(can_use_announcements boolean,can_send_company_announcements boolean)
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.can_use_announcement_tools(p_organisation_id) then
    raise exception 'You do not have access to announcements';
  end if;

  return query select true,private.can_send_company_announcements(p_organisation_id,v_user);
end;
$$;

revoke all on function public.get_announcement_permissions(uuid) from public, anon;
grant execute on function public.get_announcement_permissions(uuid) to authenticated;

create or replace function private.resolve_announcement_audience_v2(
  p_actor_user_id uuid,
  p_organisation_id uuid,
  p_scope text,
  p_lender_id uuid default null,
  p_client_ids uuid[] default null
) returns table(client_id uuid,user_id uuid,first_name text,last_name text,email text)
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_scope not in ('my_clients','all_company') then
    raise exception 'Invalid announcement scope';
  end if;

  if p_scope='all_company' and not private.can_send_company_announcements(p_organisation_id,p_actor_user_id) then
    raise exception 'You are not authorised to send announcements to all company clients';
  end if;

  if p_lender_id is not null and not exists (
    select 1 from public.lenders l
    where l.id=p_lender_id and l.organisation_id=p_organisation_id and l.active=true
  ) then
    raise exception 'Selected lender is not available for this organisation';
  end if;

  return query
  select distinct c.id,c.user_id,c.first_name,c.last_name,c.email
  from public.clients c
  where c.organisation_id=p_organisation_id
    and c.status='active'
    and c.archived_at is null
    and (
      p_scope='all_company'
      or exists (
        select 1 from public.client_assignments ca
        where ca.client_id=c.id
          and ca.organisation_id=p_organisation_id
          and ca.member_user_id=p_actor_user_id
      )
    )
    and (
      p_lender_id is null
      or exists (
        select 1
        from public.loan_applications la
        where la.client_id=c.id
          and la.organisation_id=p_organisation_id
          and la.lender_id=p_lender_id
          and la.status <> 'withdrawn'
      )
    )
    and (
      coalesce(cardinality(p_client_ids),0)=0
      or c.id=any(p_client_ids)
    )
  order by c.first_name,c.last_name;
end;
$$;

revoke all on function private.resolve_announcement_audience_v2(uuid,uuid,text,uuid,uuid[]) from public,anon,authenticated;

create or replace function public.preview_announcement_audience_v2(
  p_organisation_id uuid,
  p_scope text default 'my_clients',
  p_lender_id uuid default null,
  p_client_ids uuid[] default null
) returns table(client_id uuid,client_name text,email text,connected boolean)
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.can_use_announcement_tools(p_organisation_id) then
    raise exception 'You do not have access to announcements';
  end if;

  return query
  select r.client_id,btrim(r.first_name||' '||r.last_name),r.email,(r.user_id is not null)
  from private.resolve_announcement_audience_v2(v_user,p_organisation_id,p_scope,p_lender_id,p_client_ids) r;
end;
$$;

revoke all on function public.preview_announcement_audience_v2(uuid,text,uuid,uuid[]) from public,anon;
grant execute on function public.preview_announcement_audience_v2(uuid,text,uuid,uuid[]) to authenticated;

create or replace function public.send_announcement_v2(
  p_organisation_id uuid,
  p_scope text,
  p_title text,
  p_body text,
  p_push_requested boolean default false,
  p_lender_id uuid default null,
  p_client_ids uuid[] default null
) returns table(announcement_id uuid,recipient_count integer,connected_count integer)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_title text:=nullif(btrim(p_title),'');
  v_body text:=nullif(btrim(p_body),'');
  v_announcement uuid;
  v_total integer:=0;
  v_connected integer:=0;
  v_broker_first text;
  r record;
  v_notification uuid;
  v_rendered_title text;
  v_rendered_body text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.can_use_announcement_tools(p_organisation_id) then
    raise exception 'You do not have access to announcements';
  end if;
  if v_title is null or length(v_title)>120 then
    raise exception 'Announcement title is required and must be 120 characters or less';
  end if;
  if v_body is null or length(v_body)>4000 then
    raise exception 'Announcement message is required and must be 4000 characters or less';
  end if;

  select p.first_name into v_broker_first from public.profiles p where p.id=v_user;

  create temporary table if not exists pg_temp.aidez_announcement_audience_v2(
    client_id uuid,user_id uuid,first_name text,last_name text,email text
  ) on commit drop;
  truncate pg_temp.aidez_announcement_audience_v2;

  insert into pg_temp.aidez_announcement_audience_v2
  select * from private.resolve_announcement_audience_v2(
    v_user,p_organisation_id,p_scope,p_lender_id,p_client_ids
  );

  select count(*) into v_total from pg_temp.aidez_announcement_audience_v2;
  if v_total=0 then raise exception 'No clients match the selected recipients'; end if;

  insert into public.announcements(
    organisation_id,sender_user_id,audience_type,title,body,push_requested,status,recipient_count,sent_at
  ) values(
    p_organisation_id,v_user,p_scope,v_title,v_body,coalesce(p_push_requested,false),'sent',v_total,now()
  ) returning id into v_announcement;

  if p_lender_id is not null then
    insert into public.announcement_lenders(announcement_id,lender_id)
    values(v_announcement,p_lender_id)
    on conflict do nothing;
  end if;

  if coalesce(cardinality(p_client_ids),0)>0 then
    insert into public.announcement_selected_clients(announcement_id,client_id)
    select v_announcement,aa.client_id from pg_temp.aidez_announcement_audience_v2 aa
    on conflict do nothing;
  end if;

  for r in select * from pg_temp.aidez_announcement_audience_v2 loop
    v_notification:=null;
    if r.user_id is not null then
      v_rendered_title:=private.render_notification_template(v_title,r.first_name,v_broker_first,null);
      v_rendered_body:=private.render_notification_template(v_body,r.first_name,v_broker_first,null);

      insert into public.client_notifications(
        organisation_id,client_id,user_id,application_id,announcement_id,
        notification_type,title,body,data,push_eligible
      ) values(
        p_organisation_id,r.client_id,r.user_id,null,v_announcement,
        'announcement',v_rendered_title,v_rendered_body,
        jsonb_build_object(
          'announcement_id',v_announcement,
          'scope',p_scope,
          'lender_id',p_lender_id
        ),coalesce(p_push_requested,false)
      ) returning id into v_notification;
      v_connected:=v_connected+1;
    end if;

    insert into public.announcement_recipients(
      announcement_id,organisation_id,client_id,user_id,notification_id,delivery_state
    ) values(
      v_announcement,p_organisation_id,r.client_id,r.user_id,v_notification,
      case when r.user_id is null then 'not_connected' else 'in_app_created' end
    );
  end loop;

  insert into public.audit_events(
    organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata
  ) values(
    p_organisation_id,v_user,'announcement_sent','announcement',v_announcement,
    jsonb_build_object(
      'scope',p_scope,
      'lender_id',p_lender_id,
      'specific_client_filter',coalesce(cardinality(p_client_ids),0)>0,
      'recipient_count',v_total,
      'connected_count',v_connected,
      'push_requested',coalesce(p_push_requested,false)
    )
  );

  return query select v_announcement,v_total,v_connected;
end;
$$;

revoke all on function public.send_announcement_v2(uuid,text,text,text,boolean,uuid,uuid[]) from public,anon;
grant execute on function public.send_announcement_v2(uuid,text,text,text,boolean,uuid,uuid[]) to authenticated;

create or replace function public.list_my_announcements(p_limit integer default 100)
returns table(
  announcement_id uuid,
  notification_id uuid,
  title text,
  body text,
  sender_name text,
  sent_at timestamptz,
  read_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  return query
  select a.id,cn.id,cn.title,cn.body,
         btrim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),
         a.sent_at,cn.read_at
  from public.announcement_recipients ar
  join public.announcements a on a.id=ar.announcement_id and a.status='sent'
  join public.client_notifications cn on cn.id=ar.notification_id and cn.user_id=v_user
  left join public.profiles p on p.id=a.sender_user_id
  where ar.user_id=v_user
  order by a.sent_at desc
  limit greatest(1,least(coalesce(p_limit,100),200));
end;
$$;

revoke all on function public.list_my_announcements(integer) from public,anon;
grant execute on function public.list_my_announcements(integer) to authenticated;

create or replace function public.mark_my_announcement_read(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  update public.client_notifications cn
  set read_at=coalesce(cn.read_at,now())
  where cn.user_id=v_user
    and cn.announcement_id=p_announcement_id
    and cn.notification_type='announcement';
end;
$$;

revoke all on function public.mark_my_announcement_read(uuid) from public,anon;
grant execute on function public.mark_my_announcement_read(uuid) to authenticated;
;
