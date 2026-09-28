create or replace function public.get_announcement_history(p_organisation_id uuid,p_limit integer default 30)
returns table(
  announcement_id uuid,
  title text,
  audience_type text,
  push_requested boolean,
  recipient_count integer,
  connected_count integer,
  read_count integer,
  sent_at timestamptz
)
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not private.can_use_announcement_tools(p_organisation_id) then raise exception 'You do not have access to announcements'; end if;

  return query
  select a.id,a.title,a.audience_type,a.push_requested,a.recipient_count,
         count(ar.id) filter (where ar.delivery_state='in_app_created')::integer,
         count(ar.id) filter (where cn.read_at is not null)::integer,
         a.sent_at
  from public.announcements a
  left join public.announcement_recipients ar on ar.announcement_id=a.id
  left join public.client_notifications cn on cn.id=ar.notification_id
  where a.organisation_id=p_organisation_id
    and (a.sender_user_id=v_user or private.has_org_role(p_organisation_id,array['company_admin'::public.membership_role]))
    and a.status='sent'
  group by a.id
  order by a.sent_at desc nulls last
  limit greatest(1,least(coalesce(p_limit,30),100));
end;
$$;
revoke all on function public.get_announcement_history(uuid,integer) from public,anon;
grant execute on function public.get_announcement_history(uuid,integer) to authenticated;;
