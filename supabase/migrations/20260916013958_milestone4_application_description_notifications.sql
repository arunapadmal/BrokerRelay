alter table public.loan_applications
  add column if not exists application_description text;

alter table public.loan_applications
  drop constraint if exists loan_applications_description_length;
alter table public.loan_applications
  add constraint loan_applications_description_length
  check (application_description is null or length(application_description) <= 160);

create table if not exists public.client_notifications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  client_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid references public.loan_applications(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_notifications_client_scope_fk
    foreign key (client_id, organisation_id)
    references public.clients(id, organisation_id) on delete cascade,
  constraint client_notifications_title_length check (length(title) between 1 and 120),
  constraint client_notifications_body_length check (length(body) between 1 and 500)
);

create index if not exists client_notifications_user_created_idx
  on public.client_notifications(user_id, created_at desc);
create index if not exists client_notifications_client_created_idx
  on public.client_notifications(client_id, created_at desc);
create index if not exists client_notifications_unread_idx
  on public.client_notifications(user_id, created_at desc) where read_at is null;

alter table public.client_notifications enable row level security;

drop policy if exists client_notifications_select_own on public.client_notifications;
create policy client_notifications_select_own
on public.client_notifications for select to authenticated
using (user_id = auth.uid());

revoke all on public.client_notifications from anon;
revoke insert, update, delete on public.client_notifications from authenticated;
grant select on public.client_notifications to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='client_notifications'
  ) then
    alter publication supabase_realtime add table public.client_notifications;
  end if;
end $$;

create or replace function private.application_status_label(p_status public.application_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'preparing_application' then 'Preparing Application'
    when 'documents_required' then 'Documents Required'
    when 'ready_to_submit' then 'Ready to Submit'
    when 'submitted' then 'Submitted'
    when 'under_assessment' then 'Under Assessment'
    when 'conditional_approval' then 'Conditional Approval'
    when 'formal_approval' then 'Formal Approval'
    when 'loan_documents_issued' then 'Loan Documents Issued'
    when 'settlement_scheduled' then 'Settlement Scheduled'
    when 'settled' then 'Settled'
    when 'on_hold' then 'On Hold'
    when 'withdrawn' then 'Withdrawn'
    else initcap(replace(p_status::text, '_', ' '))
  end;
$$;
revoke all on function private.application_status_label(public.application_status) from public, anon, authenticated;

create or replace function public.update_loan_application_details(
  p_application_id uuid,
  p_application_reference text default null,
  p_application_description text default null
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
  v_description text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select la.organisation_id, la.client_id
    into v_org_id, v_client_id
  from public.loan_applications la
  where la.id = p_application_id
  for update;

  if v_org_id is null or not private.can_manage_loan_application(v_org_id, v_client_id) then
    raise exception 'You do not have access to update this application';
  end if;

  v_reference := nullif(btrim(p_application_reference), '');
  v_description := nullif(btrim(p_application_description), '');
  if v_description is not null and length(v_description) > 160 then
    raise exception 'Application description is too long';
  end if;

  update public.loan_applications
  set application_reference = v_reference,
      application_description = v_description,
      updated_at = now()
  where id = p_application_id;

  insert into public.audit_events(
    organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_org_id, v_user_id, 'loan_application_details_updated', 'loan_application', p_application_id,
    jsonb_build_object(
      'client_id', v_client_id,
      'application_reference_present', v_reference is not null,
      'application_description_present', v_description is not null
    )
  );
end;
$$;
revoke all on function public.update_loan_application_details(uuid,text,text) from public, anon;
grant execute on function public.update_loan_application_details(uuid,text,text) to authenticated;

create or replace function public.mark_client_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.client_notifications n
  set read_at = coalesce(n.read_at, now())
  where n.id = p_notification_id and n.user_id = auth.uid();
end;
$$;
revoke all on function public.mark_client_notification_read(uuid) from public, anon;
grant execute on function public.mark_client_notification_read(uuid) to authenticated;

create or replace function public.mark_all_client_notifications_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.client_notifications n
  set read_at = now()
  where n.user_id = auth.uid() and n.read_at is null;
end;
$$;
revoke all on function public.mark_all_client_notifications_read() from public, anon;
grant execute on function public.mark_all_client_notifications_read() to authenticated;

create or replace function public.get_my_notification_count()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*) from public.client_notifications n
  where n.user_id = auth.uid() and n.read_at is null;
$$;
revoke all on function public.get_my_notification_count() from public, anon;
grant execute on function public.get_my_notification_count() to authenticated;

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
  v_client_user_id uuid;
  v_old_status public.application_status;
  v_old_settlement_date date;
  v_reference text;
  v_description text;
  v_updated_at timestamptz := now();
  v_note text;
  v_subject text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select la.organisation_id, la.client_id, la.status, la.settlement_date,
         la.application_reference, la.application_description
    into v_org_id, v_client_id, v_old_status, v_old_settlement_date,
         v_reference, v_description
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
      settlement_date = case when p_status in ('settled','settlement_scheduled') then p_settlement_date else null end,
      settled_at = case
        when p_status = 'settled' and la.settled_at is null then v_updated_at
        when p_status = 'settled' then la.settled_at
        else null end,
      status_updated_by_user_id = v_user_id,
      status_updated_at = v_updated_at,
      updated_at = v_updated_at
  where la.id = p_application_id;

  if v_old_status is distinct from p_status
     or v_old_settlement_date is distinct from p_settlement_date
     or v_note is not null then
    insert into public.application_status_history(
      application_id, organisation_id, client_id, from_status, to_status,
      client_note, changed_by_user_id, created_at
    ) values (
      p_application_id, v_org_id, v_client_id, v_old_status, p_status,
      v_note, v_user_id, v_updated_at
    );

    insert into public.audit_events(
      organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata
    ) values (
      v_org_id, v_user_id, 'loan_application_status_changed', 'loan_application', p_application_id,
      jsonb_build_object(
        'client_id', v_client_id, 'from_status', v_old_status, 'to_status', p_status,
        'settlement_date', case when p_status in ('settlement_scheduled','settled') then p_settlement_date else null end
      )
    );
  end if;

  if v_old_status is distinct from p_status then
    select c.user_id into v_client_user_id
    from public.clients c
    where c.id = v_client_id and c.organisation_id = v_org_id;

    if v_client_user_id is not null then
      v_subject := coalesce(v_description, v_reference, 'Your loan application');
      insert into public.client_notifications(
        organisation_id, client_id, user_id, application_id,
        notification_type, title, body, data
      ) values (
        v_org_id, v_client_id, v_client_user_id, p_application_id,
        'application_status_changed', 'Loan application update',
        v_subject || ' is now ' || private.application_status_label(p_status) || '.',
        jsonb_build_object(
          'application_id', p_application_id,
          'application_reference', v_reference,
          'application_description', v_description,
          'status', p_status
        )
      );
    end if;
  end if;

  return query select p_application_id, p_status, v_updated_at;
end;
$$;
revoke all on function public.update_loan_application_status(uuid,public.application_status,date,text) from public, anon;
grant execute on function public.update_loan_application_status(uuid,public.application_status,date,text) to authenticated;;
