-- Milestone 3: tenant-isolated secure text messaging foundation

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint conversations_client_org_fk
    foreign key (client_id, organisation_id)
    references public.clients(id, organisation_id)
    on delete cascade,
  constraint conversations_one_per_client unique (client_id, organisation_id),
  constraint conversations_id_org_client_key unique (id, organisation_id, client_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  conversation_id uuid not null,
  client_id uuid not null,
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_conversation_scope_fk
    foreign key (conversation_id, organisation_id, client_id)
    references public.conversations(id, organisation_id, client_id)
    on delete cascade,
  constraint messages_body_not_blank check (length(btrim(body)) between 1 and 4000)
);

create table public.conversation_reads (
  conversation_id uuid not null,
  organisation_id uuid not null,
  client_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  constraint conversation_reads_scope_fk
    foreign key (conversation_id, organisation_id, client_id)
    references public.conversations(id, organisation_id, client_id)
    on delete cascade
);

create index idx_conversations_org_last_message on public.conversations (organisation_id, last_message_at desc nulls last);
create index idx_conversations_client on public.conversations (client_id);
create index idx_messages_conversation_created on public.messages (conversation_id, created_at, id);
create index idx_messages_org_client_created on public.messages (organisation_id, client_id, created_at desc);
create index idx_messages_sender on public.messages (sender_user_id);
create index idx_conversation_reads_user on public.conversation_reads (user_id, conversation_id);

-- Messaging deliberately does not grant platform admins routine access to message content.
create or replace function private.can_access_conversation(
  p_organisation_id uuid,
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversations conv
    join public.clients c
      on c.id = conv.client_id
     and c.organisation_id = conv.organisation_id
    where conv.id = p_conversation_id
      and conv.organisation_id = p_organisation_id
      and (
        c.user_id = (select auth.uid())
        or exists (
          select 1
          from public.client_assignments ca
          join public.organisation_memberships om
            on om.organisation_id = ca.organisation_id
           and om.user_id = ca.member_user_id
          where ca.organisation_id = conv.organisation_id
            and ca.client_id = conv.client_id
            and ca.member_user_id = (select auth.uid())
            and om.status = 'active'
        )
        or exists (
          select 1
          from public.organisation_memberships om
          where om.organisation_id = conv.organisation_id
            and om.user_id = (select auth.uid())
            and om.status = 'active'
            and om.role = 'company_admin'
        )
      )
  );
$$;

create or replace function private.can_message_client(
  p_organisation_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and c.organisation_id = p_organisation_id
      and c.connected_at is not null
      and c.status <> 'archived'
      and (
        c.user_id = (select auth.uid())
        or exists (
          select 1
          from public.client_assignments ca
          join public.organisation_memberships om
            on om.organisation_id = ca.organisation_id
           and om.user_id = ca.member_user_id
          where ca.organisation_id = c.organisation_id
            and ca.client_id = c.id
            and ca.member_user_id = (select auth.uid())
            and om.status = 'active'
        )
        or exists (
          select 1
          from public.organisation_memberships om
          where om.organisation_id = c.organisation_id
            and om.user_id = (select auth.uid())
            and om.status = 'active'
            and om.role = 'company_admin'
        )
      )
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.can_access_conversation(uuid, uuid) to authenticated;
grant execute on function private.can_message_client(uuid, uuid) to authenticated;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_reads enable row level security;

create policy conversations_select_allowed
on public.conversations
for select
to authenticated
using (private.can_access_conversation(organisation_id, id));

create policy messages_select_allowed
on public.messages
for select
to authenticated
using (private.can_access_conversation(organisation_id, conversation_id));

create policy conversation_reads_select_own
on public.conversation_reads
for select
to authenticated
using (user_id = (select auth.uid()) and private.can_access_conversation(organisation_id, conversation_id));

-- All writes go through the RPCs below. The base tables are read-only to app clients.
grant select on public.conversations to authenticated;
grant select on public.messages to authenticated;
grant select on public.conversation_reads to authenticated;

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

  return query select v_message_id, v_conversation_id, v_created_at;
end;
$$;

create or replace function public.mark_conversation_read(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  insert into public.conversation_reads (
    conversation_id, organisation_id, client_id, user_id, last_read_at, updated_at
  )
  values (
    p_conversation_id, v_org_id, v_client_id, v_user_id, v_last_message_at, now()
  )
  on conflict (conversation_id, user_id)
  do update set
    last_read_at = greatest(public.conversation_reads.last_read_at, excluded.last_read_at),
    updated_at = now();
end;
$$;

grant execute on function public.send_message(uuid, text) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Realtime publication for live message delivery. RLS still controls subscriber visibility.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;;
