create type public.application_status as enum (
  'preparing_application',
  'documents_required',
  'ready_to_submit',
  'submitted',
  'under_assessment',
  'conditional_approval',
  'formal_approval',
  'loan_documents_issued',
  'settlement_scheduled',
  'settled',
  'on_hold',
  'withdrawn'
);

create table public.loan_applications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null,
  application_reference text,
  status public.application_status not null default 'preparing_application',
  client_note text,
  settlement_date date,
  settled_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  status_updated_by_user_id uuid references auth.users(id) on delete set null,
  status_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loan_applications_client_scope_fk
    foreign key (client_id, organisation_id)
    references public.clients(id, organisation_id)
    on delete cascade,
  constraint loan_applications_reference_not_blank
    check (application_reference is null or length(btrim(application_reference)) > 0),
  constraint loan_applications_client_note_length
    check (client_note is null or length(client_note) <= 1000),
  constraint loan_applications_settled_requires_date
    check (status <> 'settled' or settlement_date is not null),
  constraint loan_applications_id_org_client_key unique (id, organisation_id, client_id)
);

create unique index loan_applications_reference_unique_per_org
  on public.loan_applications (organisation_id, application_reference)
  where application_reference is not null;
create index idx_loan_applications_client_created
  on public.loan_applications (client_id, created_at desc);
create index idx_loan_applications_org_status_updated
  on public.loan_applications (organisation_id, status, status_updated_at desc);
create index idx_loan_applications_created_by
  on public.loan_applications (created_by_user_id);
create index idx_loan_applications_status_updated_by
  on public.loan_applications (status_updated_by_user_id);

create table public.application_status_history (
  id bigint generated always as identity primary key,
  application_id uuid not null,
  organisation_id uuid not null,
  client_id uuid not null,
  from_status public.application_status,
  to_status public.application_status not null,
  client_note text,
  changed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint application_status_history_application_scope_fk
    foreign key (application_id, organisation_id, client_id)
    references public.loan_applications(id, organisation_id, client_id)
    on delete cascade,
  constraint application_status_history_note_length
    check (client_note is null or length(client_note) <= 1000)
);

create index idx_application_status_history_application_created
  on public.application_status_history (application_id, created_at desc);
create index idx_application_status_history_scope_fk
  on public.application_status_history (application_id, organisation_id, client_id);
create index idx_application_status_history_changed_by
  on public.application_status_history (changed_by_user_id);

create or replace function private.can_view_loan_application(
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
      and (
        c.user_id = (select auth.uid())
        or exists (
          select 1
          from public.organisation_memberships om
          where om.organisation_id = p_organisation_id
            and om.user_id = (select auth.uid())
            and om.status = 'active'
            and om.role = 'company_admin'
        )
        or exists (
          select 1
          from public.client_assignments ca
          join public.organisation_memberships om
            on om.organisation_id = ca.organisation_id
           and om.user_id = ca.member_user_id
          where ca.organisation_id = p_organisation_id
            and ca.client_id = p_client_id
            and ca.member_user_id = (select auth.uid())
            and om.status = 'active'
        )
      )
  );
$$;

create or replace function private.can_manage_loan_application(
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
        exists (
          select 1
          from public.organisation_memberships om
          where om.organisation_id = p_organisation_id
            and om.user_id = (select auth.uid())
            and om.status = 'active'
            and om.role = 'company_admin'
        )
        or exists (
          select 1
          from public.client_assignments ca
          join public.organisation_memberships om
            on om.organisation_id = ca.organisation_id
           and om.user_id = ca.member_user_id
          where ca.organisation_id = p_organisation_id
            and ca.client_id = p_client_id
            and ca.member_user_id = (select auth.uid())
            and om.status = 'active'
        )
      )
  );
$$;

revoke all on function private.can_view_loan_application(uuid, uuid) from public;
revoke all on function private.can_manage_loan_application(uuid, uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.can_view_loan_application(uuid, uuid) to authenticated;
grant execute on function private.can_manage_loan_application(uuid, uuid) to authenticated;

alter table public.loan_applications enable row level security;
alter table public.application_status_history enable row level security;

create policy loan_applications_select_allowed
on public.loan_applications
for select
to authenticated
using (private.can_view_loan_application(organisation_id, client_id));

create policy application_status_history_select_allowed
on public.application_status_history
for select
to authenticated
using (private.can_view_loan_application(organisation_id, client_id));

revoke all on public.loan_applications from anon, authenticated;
revoke all on public.application_status_history from anon, authenticated;
grant select on public.loan_applications to authenticated;
grant select on public.application_status_history to authenticated;
grant usage, select on sequence public.application_status_history_id_seq to authenticated;

create or replace function public.create_loan_application(
  p_client_id uuid,
  p_application_reference text default null,
  p_status public.application_status default 'preparing_application',
  p_settlement_date date default null,
  p_client_note text default null
)
returns table(application_id uuid, status public.application_status, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_application_id uuid;
  v_created_at timestamptz;
  v_reference text;
  v_note text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select c.organisation_id into v_org_id
  from public.clients c
  where c.id = p_client_id;

  if v_org_id is null or not private.can_manage_loan_application(v_org_id, p_client_id) then
    raise exception 'You do not have access to create an application for this client';
  end if;

  v_reference := nullif(btrim(p_application_reference), '');
  v_note := nullif(btrim(p_client_note), '');

  if v_note is not null and length(v_note) > 1000 then
    raise exception 'Client note is too long';
  end if;

  if p_status = 'settled' and p_settlement_date is null then
    raise exception 'Settlement date is required when status is Settled';
  end if;

  insert into public.loan_applications (
    organisation_id, client_id, application_reference, status,
    client_note, settlement_date, settled_at,
    created_by_user_id, status_updated_by_user_id
  ) values (
    v_org_id, p_client_id, v_reference, p_status,
    v_note, p_settlement_date,
    case when p_status = 'settled' then now() else null end,
    v_user_id, v_user_id
  )
  returning id, public.loan_applications.created_at
    into v_application_id, v_created_at;

  insert into public.application_status_history (
    application_id, organisation_id, client_id,
    from_status, to_status, client_note, changed_by_user_id
  ) values (
    v_application_id, v_org_id, p_client_id,
    null, p_status, v_note, v_user_id
  );

  insert into public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_org_id, v_user_id, 'loan_application_created', 'loan_application', v_application_id,
    jsonb_build_object(
      'client_id', p_client_id,
      'status', p_status,
      'application_reference_present', v_reference is not null
    )
  );

  return query select v_application_id, p_status, v_created_at;
end;
$$;

create or replace function public.update_loan_application_status(
  p_application_id uuid,
  p_status public.application_status,
  p_settlement_date date default null,
  p_client_note text default null
)
returns table(application_id uuid, status public.application_status, status_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_client_id uuid;
  v_old_status public.application_status;
  v_old_settlement_date date;
  v_updated_at timestamptz := now();
  v_note text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select la.organisation_id, la.client_id, la.status, la.settlement_date
    into v_org_id, v_client_id, v_old_status, v_old_settlement_date
  from public.loan_applications la
  where la.id = p_application_id
  for update;

  if v_org_id is null or not private.can_manage_loan_application(v_org_id, v_client_id) then
    raise exception 'You do not have access to update this application';
  end if;

  v_note := nullif(btrim(p_client_note), '');
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'Client note is too long';
  end if;

  if p_status = 'settled' and p_settlement_date is null then
    raise exception 'Settlement date is required when status is Settled';
  end if;

  update public.loan_applications la
  set status = p_status,
      client_note = v_note,
      settlement_date = case
        when p_status = 'settled' then p_settlement_date
        when p_status = 'settlement_scheduled' then p_settlement_date
        else null
      end,
      settled_at = case
        when p_status = 'settled' and la.settled_at is null then v_updated_at
        when p_status = 'settled' then la.settled_at
        else null
      end,
      status_updated_by_user_id = v_user_id,
      status_updated_at = v_updated_at,
      updated_at = v_updated_at
  where la.id = p_application_id;

  if v_old_status is distinct from p_status
     or v_old_settlement_date is distinct from p_settlement_date
     or v_note is not null then
    insert into public.application_status_history (
      application_id, organisation_id, client_id,
      from_status, to_status, client_note, changed_by_user_id, created_at
    ) values (
      p_application_id, v_org_id, v_client_id,
      v_old_status, p_status, v_note, v_user_id, v_updated_at
    );

    insert into public.audit_events (
      organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata
    ) values (
      v_org_id, v_user_id, 'loan_application_status_changed', 'loan_application', p_application_id,
      jsonb_build_object(
        'client_id', v_client_id,
        'from_status', v_old_status,
        'to_status', p_status,
        'settlement_date', case when p_status in ('settlement_scheduled','settled') then p_settlement_date else null end
      )
    );
  end if;

  return query select p_application_id, p_status, v_updated_at;
end;
$$;

create or replace function public.update_loan_application_reference(
  p_application_id uuid,
  p_application_reference text
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
  v_reference text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select la.organisation_id, la.client_id
    into v_org_id, v_client_id
  from public.loan_applications la
  where la.id = p_application_id
  for update;

  if v_org_id is null or not private.can_manage_loan_application(v_org_id, v_client_id) then
    raise exception 'You do not have access to update this application';
  end if;

  v_reference := nullif(btrim(p_application_reference), '');

  update public.loan_applications
  set application_reference = v_reference,
      updated_at = now()
  where id = p_application_id;

  insert into public.audit_events (
    organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_org_id, v_user_id, 'loan_application_reference_updated', 'loan_application', p_application_id,
    jsonb_build_object('client_id', v_client_id, 'application_reference_present', v_reference is not null)
  );
end;
$$;

revoke all on function public.create_loan_application(uuid, text, public.application_status, date, text) from public;
revoke all on function public.update_loan_application_status(uuid, public.application_status, date, text) from public;
revoke all on function public.update_loan_application_reference(uuid, text) from public;
grant execute on function public.create_loan_application(uuid, text, public.application_status, date, text) to authenticated;
grant execute on function public.update_loan_application_status(uuid, public.application_status, date, text) to authenticated;
grant execute on function public.update_loan_application_reference(uuid, text) to authenticated;

alter publication supabase_realtime add table public.loan_applications;
alter publication supabase_realtime add table public.application_status_history;;
