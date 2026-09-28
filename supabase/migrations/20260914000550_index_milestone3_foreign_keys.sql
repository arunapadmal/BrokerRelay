create index idx_conversations_created_by on public.conversations (created_by_user_id);
create index idx_messages_scope_fk on public.messages (conversation_id, organisation_id, client_id);
create index idx_conversation_reads_scope_fk on public.conversation_reads (conversation_id, organisation_id, client_id);;
