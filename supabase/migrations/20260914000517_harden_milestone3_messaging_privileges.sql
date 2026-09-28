revoke all on public.conversations from anon;
revoke all on public.messages from anon;
revoke all on public.conversation_reads from anon;

revoke insert, update, delete, truncate, references, trigger on public.conversations from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.messages from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.conversation_reads from authenticated;

grant select on public.conversations to authenticated;
grant select on public.messages to authenticated;
grant select on public.conversation_reads to authenticated;

revoke all on function public.send_message(uuid, text) from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

revoke all on function private.can_access_conversation(uuid, uuid) from public, anon;
revoke all on function private.can_message_client(uuid, uuid) from public, anon;
grant execute on function private.can_access_conversation(uuid, uuid) to authenticated;
grant execute on function private.can_message_client(uuid, uuid) to authenticated;;
