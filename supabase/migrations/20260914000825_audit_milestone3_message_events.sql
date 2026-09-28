create or replace function public.send_message(
  p_client_id uuid,
  p_body text
)
returns table (
  message_id uuid,
  conversation_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_created_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_body is null or length(btrim(p_body)) < 1 then
    raise exception 'Message cannot be empty';
  end if;

  if length(p_body) > 4000 then
    raise exception 'Message is too long';
  end if;

  select c.organisation_id
    into v_org_id
  from public.clients c
  where c.id = p_client_id;

  if v_org_id is null or not private.can_message_client(v_org_id, p_client_id) then
    raise exception 'You do not have access to message this client';
  end if;

  insert into public.conversations (
    organisation_id, client_id, created_by_user_id, last_message_at
  )
  values (
    v_org_id, p_client_id, v_user_id, now()
  )
  on conflict on constraint conversations_one_per_client
  do update set updated_at = now()
  returning id into v_conversation_id;

  insert into public.messages (
    organisation_id, conversation_id, client_id, sender_user_id, body
  )
  values (
    v_org_id, v_conversation_id, p_client_id, v_user_id, btrim(p_body)
  )
  returning id, public.messages.created_at
    into v_message_id, v_created_at;

  update public.conversations
  set last_message_at = v_created_at,
      updated_at = v_created_at
  where id = v_conversation_id;

  insert into public.conversation_reads (
    conversation_id, organisation_id, client_id, user_id, last_read_at, updated_at
  )
  values (
    v_conversation_id, v_org_id, p_client_id, v_user_id, v_created_at, now()
  )
  on conflict (conversation_id, user_id)
  do update set
    last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at),
    updated_at = now();

  insert into public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_org_id,
    v_user_id,
    'message_sent',
    'message',
    v_message_id,
    jsonb_build_object(
      'conversation_id', v_conversation_id,
      'client_id', p_client_id,
      'character_count', length(btrim(p_body))
    )
  );

  return query select v_message_id, v_conversation_id, v_created_at;
end;
$$;

revoke all on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;;
