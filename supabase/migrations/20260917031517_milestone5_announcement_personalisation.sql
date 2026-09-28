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
  v_broker_first text;
  r record;
  v_notification uuid;
  v_rendered_title text;
  v_rendered_body text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.can_use_announcement_tools(p_organisation_id) then raise exception 'You do not have access to announcements'; end if;
  if v_title is null or length(v_title)>120 then raise exception 'Announcement title is required and must be 120 characters or less'; end if;
  if v_body is null or length(v_body)>4000 then raise exception 'Announcement message is required and must be 4000 characters or less'; end if;

  select p.first_name into v_broker_first from public.profiles p where p.id=v_user;

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
      v_rendered_title:=private.render_notification_template(v_title,r.first_name,v_broker_first,null);
      v_rendered_body:=private.render_notification_template(v_body,r.first_name,v_broker_first,null);
      insert into public.client_notifications(
        organisation_id,client_id,user_id,application_id,announcement_id,notification_type,title,body,data,push_eligible
      ) values(
        p_organisation_id,r.client_id,r.user_id,null,v_announcement,'announcement',v_rendered_title,v_rendered_body,
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

create or replace function public.get_my_announcement(p_announcement_id uuid)
returns table(announcement_id uuid,title text,body text,sender_name text,sent_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  return query
  select a.id,
         private.render_notification_template(a.title,c.first_name,p.first_name,null),
         private.render_notification_template(a.body,c.first_name,p.first_name,null),
         btrim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')),
         a.sent_at
  from public.announcements a
  join public.announcement_recipients ar on ar.announcement_id=a.id and ar.user_id=v_user
  join public.clients c on c.id=ar.client_id
  left join public.profiles p on p.id=a.sender_user_id
  where a.id=p_announcement_id;
end;
$$;
revoke all on function public.send_announcement(uuid,text,text,text,boolean,uuid[],uuid[]) from public,anon;
grant execute on function public.send_announcement(uuid,text,text,text,boolean,uuid[],uuid[]) to authenticated;
revoke all on function public.get_my_announcement(uuid) from public,anon;
grant execute on function public.get_my_announcement(uuid) to authenticated;;
