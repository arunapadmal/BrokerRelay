create or replace function public.get_my_unread_counts()
returns table (
  client_id uuid,
  conversation_id uuid,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    conv.client_id,
    conv.id as conversation_id,
    count(m.id) filter (
      where m.sender_user_id <> (select auth.uid())
        and m.created_at > coalesce(cr.last_read_at, '1970-01-01'::timestamptz)
    ) as unread_count
  from public.conversations conv
  left join public.conversation_reads cr
    on cr.conversation_id = conv.id
   and cr.user_id = (select auth.uid())
  left join public.messages m
    on m.conversation_id = conv.id
  group by conv.client_id, conv.id, cr.last_read_at;
$$;

revoke all on function public.get_my_unread_counts() from public, anon;
grant execute on function public.get_my_unread_counts() to authenticated;;
