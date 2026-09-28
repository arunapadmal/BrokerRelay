-- Broker messages are already saved in public.messages; notify the connected
-- client without copying the private message text into a notification.
create or replace function private.notify_client_of_secure_message()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_client_user_id uuid;
begin
  select c.user_id into v_client_user_id
  from public.clients c
  where c.id = new.client_id
    and c.organisation_id = new.organisation_id
    and c.status = 'active'
    and c.connected_at is not null;

  if v_client_user_id is not null and v_client_user_id <> new.sender_user_id then
    insert into public.client_notifications
      (organisation_id, client_id, user_id, notification_type,
       title, body, data, push_eligible)
    values
      (new.organisation_id, new.client_id, v_client_user_id, 'secure_message',
       'New secure message', 'Your brokerage sent you a secure message.',
       jsonb_build_object('conversation_id', new.conversation_id,
                          'message_id', new.id), false);
  end if;

  return new;
end $$;
revoke all on function private.notify_client_of_secure_message() from public, anon, authenticated;

drop trigger if exists messages_notify_client_secure_message on public.messages;
create trigger messages_notify_client_secure_message
after insert on public.messages
for each row execute function private.notify_client_of_secure_message();

-- Opening the conversation clears message notifications through the same
-- authorised read marker used by unread message counts. Only messages up to
-- the read marker are cleared, so a concurrent new reply stays unread.
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_client_id uuid;
  v_last_message_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select organisation_id, client_id, coalesce(last_message_at, now())
    into v_org_id, v_client_id, v_last_message_at
  from public.conversations
  where id = p_conversation_id;

  if v_org_id is null or not private.can_access_conversation(v_org_id, p_conversation_id) then
    raise exception 'You do not have access to this conversation';
  end if;

  insert into public.conversation_reads
    (conversation_id, organisation_id, client_id, user_id, last_read_at, updated_at)
  values
    (p_conversation_id, v_org_id, v_client_id, v_user_id, v_last_message_at, now())
  on conflict (conversation_id, user_id)
  do update set
    last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at),
    updated_at = now();

  update public.client_notifications n
  set read_at = now()
  where n.organisation_id = v_org_id
    and n.client_id = v_client_id
    and n.user_id = v_user_id
    and n.notification_type = 'secure_message'
    and n.read_at is null
    and n.data->>'conversation_id' = p_conversation_id::text
    and exists (
      select 1 from public.messages m
      where m.id::text = n.data->>'message_id'
        and m.conversation_id = p_conversation_id
        and m.created_at <= v_last_message_at
    );
end $$;
