create extension if not exists pg_cron;

alter table public.organisations
  add column if not exists timezone text not null default 'Australia/Melbourne';

alter table public.loan_applications
  add column if not exists client_view_state text not null default 'active',
  add column if not exists archived_at timestamptz;

alter table public.loan_applications
  drop constraint if exists loan_applications_client_view_state_check;
alter table public.loan_applications
  add constraint loan_applications_client_view_state_check
  check (client_view_state in ('active','past'));

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id) on delete cascade,
  broker_user_id uuid references auth.users(id) on delete cascade,
  template_key text not null,
  channel text not null default 'in_app' check (channel in ('in_app','push')),
  title_template text not null,
  body_template text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(title_template) between 1 and 120),
  check (length(body_template) between 1 and 1000),
  check (template_key in (
    'settlement_confirmation','settlement_1_month','settlement_6_month',
    'settlement_12_month','settlement_annual'
  )),
  check (broker_user_id is null or organisation_id is not null)
);

create unique index if not exists notification_templates_platform_unique
  on public.notification_templates(template_key, channel)
  where organisation_id is null and broker_user_id is null;
create unique index if not exists notification_templates_org_unique
  on public.notification_templates(organisation_id, template_key, channel)
  where organisation_id is not null and broker_user_id is null;
create unique index if not exists notification_templates_broker_unique
  on public.notification_templates(organisation_id, broker_user_id, template_key, channel)
  where organisation_id is not null and broker_user_id is not null;

alter table public.notification_templates enable row level security;
drop policy if exists notification_templates_select_allowed on public.notification_templates;
create policy notification_templates_select_allowed
on public.notification_templates for select to authenticated
using (
  (organisation_id is null and broker_user_id is null)
  or (
    organisation_id is not null
    and exists (
      select 1 from public.organisation_memberships om
      where om.organisation_id = notification_templates.organisation_id
        and om.user_id = auth.uid()
        and om.status = 'active'
    )
  )
);
revoke insert, update, delete on public.notification_templates from anon, authenticated;
grant select on public.notification_templates to authenticated;

insert into public.notification_templates(
  organisation_id, broker_user_id, template_key, channel, title_template, body_template
) values
(null, null, 'settlement_confirmation', 'in_app', 'Congratulations!', 'Congratulations, {{client_first_name}}! Your loan has settled.'),
(null, null, 'settlement_1_month', 'in_app', 'One-month check-in', 'Hi {{client_first_name}}, it has been one month since settlement. I hope everything is going smoothly. If you need anything, I’m here to help. – {{broker_first_name}}'),
(null, null, 'settlement_6_month', 'in_app', 'Six-month loan review', 'Hi {{client_first_name}}, it has been six months since settlement. If you would like to review your loan or discuss any changes, please get in touch. – {{broker_first_name}}'),
(null, null, 'settlement_12_month', 'in_app', 'Annual mortgage review', 'Hi {{client_first_name}}, it has been 12 months since settlement. It may be a good time to review your loan and make sure it still suits your needs. – {{broker_first_name}}'),
(null, null, 'settlement_annual', 'in_app', 'Annual mortgage review', 'Hi {{client_first_name}}, it is time for your annual loan review. If you would like to check that your loan still suits your needs, please get in touch. – {{broker_first_name}}')
on conflict do nothing;

create table if not exists public.scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  application_id uuid not null references public.loan_applications(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  broker_user_id uuid references auth.users(id) on delete set null,
  action_type text not null check (action_type in (
    'settlement_1_month','settlement_6_month','settlement_12_month',
    'settlement_annual','auto_archive_90_days'
  )),
  due_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','processing','completed','failed','cancelled')),
  idempotency_key text not null unique,
  attempts integer not null default 0,
  last_error text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scheduled_actions_due_idx
  on public.scheduled_actions(state, due_at);
create index if not exists scheduled_actions_client_idx
  on public.scheduled_actions(organisation_id, client_id, due_at);

alter table public.scheduled_actions enable row level security;
drop policy if exists scheduled_actions_select_staff on public.scheduled_actions;
create policy scheduled_actions_select_staff
on public.scheduled_actions for select to authenticated
using (private.can_manage_loan_application(organisation_id, client_id));
revoke insert, update, delete on public.scheduled_actions from anon, authenticated;
grant select on public.scheduled_actions to authenticated;

alter table public.client_notifications
  add column if not exists source_scheduled_action_id uuid references public.scheduled_actions(id) on delete set null,
  add column if not exists push_eligible boolean not null default false,
  add column if not exists push_sent_at timestamptz;
create unique index if not exists client_notifications_source_action_unique
  on public.client_notifications(source_scheduled_action_id)
  where source_scheduled_action_id is not null;

create or replace function private.render_notification_template(
  p_template text,
  p_client_first_name text,
  p_broker_first_name text,
  p_application_description text
) returns text
language sql immutable
set search_path = ''
as $$
  select replace(
           replace(
             replace(p_template,
               '{{client_first_name}}', coalesce(nullif(p_client_first_name,''), 'there')),
             '{{broker_first_name}}', coalesce(nullif(p_broker_first_name,''), 'your broker')),
           '{{application_description}}', coalesce(nullif(p_application_description,''), 'your loan application'));
$$;

create or replace function private.primary_broker_for_client(
  p_organisation_id uuid,
  p_client_id uuid
) returns uuid
language sql stable security definer
set search_path = ''
as $$
  select ca.member_user_id
  from public.client_assignments ca
  join public.organisation_memberships om
    on om.organisation_id = ca.organisation_id
   and om.user_id = ca.member_user_id
   and om.status = 'active'
  where ca.organisation_id = p_organisation_id
    and ca.client_id = p_client_id
  order by (ca.assignment_role = 'primary_broker') desc, ca.created_at asc
  limit 1;
$$;

create or replace function private.resolve_notification_template(
  p_organisation_id uuid,
  p_broker_user_id uuid,
  p_template_key text,
  p_channel text default 'in_app'
) returns table(title_template text, body_template text, template_source text)
language sql stable security definer
set search_path = ''
as $$
  select nt.title_template,
         nt.body_template,
         case
           when nt.broker_user_id is not null then 'broker'
           when nt.organisation_id is not null then 'company'
           else 'platform'
         end as template_source
  from public.notification_templates nt
  where nt.template_key = p_template_key
    and nt.channel = p_channel
    and nt.is_active
    and (
      (nt.organisation_id = p_organisation_id and nt.broker_user_id = p_broker_user_id)
      or (nt.organisation_id = p_organisation_id and nt.broker_user_id is null)
      or (nt.organisation_id is null and nt.broker_user_id is null)
    )
  order by
    case
      when nt.organisation_id = p_organisation_id and nt.broker_user_id = p_broker_user_id then 1
      when nt.organisation_id = p_organisation_id and nt.broker_user_id is null then 2
      else 3
    end
  limit 1;
$$;

create or replace function private.schedule_settlement_actions(
  p_application_id uuid,
  p_organisation_id uuid,
  p_client_id uuid,
  p_broker_user_id uuid,
  p_settlement_date date
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_due timestamptz;
  v_type text;
  v_offset interval;
begin
  select o.timezone into v_timezone from public.organisations o where o.id = p_organisation_id;
  v_timezone := coalesce(nullif(v_timezone,''), 'Australia/Melbourne');

  for v_type, v_offset in
    select * from (values
      ('settlement_1_month'::text, interval '1 month'),
      ('settlement_6_month'::text, interval '6 months'),
      ('settlement_12_month'::text, interval '12 months'),
      ('auto_archive_90_days'::text, interval '90 days')
    ) as x(action_type, offset_value)
  loop
    v_due := (((p_settlement_date + v_offset)::date + time '09:00') at time zone v_timezone);
    insert into public.scheduled_actions(
      organisation_id, application_id, client_id, broker_user_id,
      action_type, due_at, state, idempotency_key
    ) values (
      p_organisation_id, p_application_id, p_client_id, p_broker_user_id,
      v_type, v_due, 'pending', p_application_id::text || ':' || v_type
    )
    on conflict (idempotency_key) do update
      set due_at = excluded.due_at,
          broker_user_id = excluded.broker_user_id,
          state = 'pending',
          attempts = 0,
          last_error = null,
          cancelled_at = null,
          updated_at = now()
      where public.scheduled_actions.state <> 'completed';
  end loop;
end;
$$;

create or replace function private.cancel_settlement_actions(
  p_application_id uuid
) returns void
language sql security definer
set search_path = ''
as $$
  update public.scheduled_actions
  set state = 'cancelled', cancelled_at = now(), updated_at = now()
  where application_id = p_application_id
    and action_type in (
      'settlement_1_month','settlement_6_month','settlement_12_month',
      'settlement_annual','auto_archive_90_days'
    )
    and state in ('pending','failed');
$$;

create or replace function public.save_my_followup_template(
  p_organisation_id uuid,
  p_template_key text,
  p_title_template text,
  p_body_template text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_title text := nullif(btrim(p_title_template),'');
  v_body text := nullif(btrim(p_body_template),'');
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_template_key not in ('settlement_confirmation','settlement_1_month','settlement_6_month','settlement_12_month','settlement_annual') then
    raise exception 'Invalid template key';
  end if;
  if not exists (
    select 1 from public.organisation_memberships om
    where om.organisation_id = p_organisation_id and om.user_id = v_user_id and om.status = 'active'
  ) then raise exception 'Active organisation membership required'; end if;
  if v_title is null or length(v_title) > 120 then raise exception 'Title must be 1-120 characters'; end if;
  if v_body is null or length(v_body) > 1000 then raise exception 'Message must be 1-1000 characters'; end if;

  update public.notification_templates nt
  set title_template = v_title, body_template = v_body, is_active = true, updated_at = now()
  where nt.organisation_id = p_organisation_id
    and nt.broker_user_id = v_user_id
    and nt.template_key = p_template_key
    and nt.channel = 'in_app';

  if not found then
    insert into public.notification_templates(
      organisation_id, broker_user_id, template_key, channel,
      title_template, body_template
    ) values (
      p_organisation_id, v_user_id, p_template_key, 'in_app', v_title, v_body
    );
  end if;

  insert into public.audit_events(organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (p_organisation_id, v_user_id, 'notification_template_saved', 'notification_template', null,
          jsonb_build_object('template_key',p_template_key,'scope','broker'));
end;
$$;

create or replace function public.reset_my_followup_template(
  p_organisation_id uuid,
  p_template_key text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.organisation_memberships om
    where om.organisation_id = p_organisation_id and om.user_id = v_user_id and om.status='active'
  ) then raise exception 'Active organisation membership required'; end if;
  delete from public.notification_templates nt
  where nt.organisation_id=p_organisation_id and nt.broker_user_id=v_user_id
    and nt.template_key=p_template_key and nt.channel='in_app';
end;
$$;

create or replace function public.get_my_followup_templates(
  p_organisation_id uuid
) returns table(
  template_key text,
  title_template text,
  body_template text,
  template_source text
)
language plpgsql stable security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid(); v_key text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.organisation_memberships om
    where om.organisation_id=p_organisation_id and om.user_id=v_user_id and om.status='active'
  ) then raise exception 'Active organisation membership required'; end if;

  foreach v_key in array array['settlement_confirmation','settlement_1_month','settlement_6_month','settlement_12_month','settlement_annual'] loop
    return query
      select v_key, r.title_template, r.body_template, r.template_source
      from private.resolve_notification_template(p_organisation_id, v_user_id, v_key, 'in_app') r;
  end loop;
end;
$$;

revoke all on function public.save_my_followup_template(uuid,text,text,text) from public, anon;
revoke all on function public.reset_my_followup_template(uuid,text) from public, anon;
revoke all on function public.get_my_followup_templates(uuid) from public, anon;
grant execute on function public.save_my_followup_template(uuid,text,text,text) to authenticated;
grant execute on function public.reset_my_followup_template(uuid,text) to authenticated;
grant execute on function public.get_my_followup_templates(uuid) to authenticated;

create or replace function public.process_due_scheduled_actions(
  p_limit integer default 100
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  r public.scheduled_actions%rowtype;
  v_user_id uuid;
  v_client_first text;
  v_broker_first text;
  v_description text;
  v_status public.application_status;
  v_title_t text;
  v_body_t text;
  v_title text;
  v_body text;
  v_next_due timestamptz;
  v_count integer := 0;
begin
  for r in
    select sa.* from public.scheduled_actions sa
    where sa.state in ('pending','failed') and sa.due_at <= now()
    order by sa.due_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,100),500))
  loop
    begin
      update public.scheduled_actions set state='processing', attempts=attempts+1, updated_at=now() where id=r.id;

      select la.status, la.application_description into v_status, v_description
      from public.loan_applications la where la.id=r.application_id;

      if r.action_type = 'auto_archive_90_days' then
        if v_status = 'settled' then
          update public.loan_applications
          set client_view_state='past', archived_at=coalesce(archived_at,now()), updated_at=now()
          where id=r.application_id;
        end if;
        update public.scheduled_actions set state='completed', completed_at=now(), updated_at=now() where id=r.id;
        v_count := v_count + 1;
        continue;
      end if;

      if v_status <> 'settled' then
        update public.scheduled_actions set state='cancelled', cancelled_at=now(), updated_at=now() where id=r.id;
        continue;
      end if;

      select c.user_id, c.first_name into v_user_id, v_client_first
      from public.clients c where c.id=r.client_id and c.organisation_id=r.organisation_id;

      if v_user_id is null then
        update public.scheduled_actions
        set state='failed', last_error='client_not_connected', due_at=now()+interval '1 day', updated_at=now()
        where id=r.id;
        continue;
      end if;

      select p.first_name into v_broker_first from public.profiles p where p.id=r.broker_user_id;
      select x.title_template, x.body_template into v_title_t, v_body_t
      from private.resolve_notification_template(r.organisation_id, r.broker_user_id, r.action_type, 'in_app') x;

      if v_title_t is null or v_body_t is null then
        raise exception 'No active template for %', r.action_type;
      end if;

      v_title := private.render_notification_template(v_title_t, v_client_first, v_broker_first, v_description);
      v_body := private.render_notification_template(v_body_t, v_client_first, v_broker_first, v_description);

      insert into public.client_notifications(
        organisation_id, client_id, user_id, application_id,
        notification_type, title, body, data,
        source_scheduled_action_id, push_eligible
      ) values (
        r.organisation_id, r.client_id, v_user_id, r.application_id,
        r.action_type, v_title, v_body,
        jsonb_build_object('application_id',r.application_id,'scheduled_action_id',r.id,'action_type',r.action_type),
        r.id, true
      ) on conflict (source_scheduled_action_id) where source_scheduled_action_id is not null do nothing;

      update public.scheduled_actions
      set state='completed', completed_at=now(), last_error=null, updated_at=now()
      where id=r.id;

      if r.action_type in ('settlement_12_month','settlement_annual') then
        v_next_due := r.due_at + interval '1 year';
        insert into public.scheduled_actions(
          organisation_id, application_id, client_id, broker_user_id,
          action_type, due_at, state, idempotency_key
        ) values (
          r.organisation_id, r.application_id, r.client_id, r.broker_user_id,
          'settlement_annual', v_next_due, 'pending',
          r.application_id::text || ':settlement_annual:' || to_char(v_next_due at time zone 'UTC','YYYY-MM-DD')
        ) on conflict (idempotency_key) do nothing;
      end if;

      v_count := v_count + 1;
    exception when others then
      update public.scheduled_actions
      set state='failed', last_error=left(sqlerrm,500), due_at=now()+interval '1 hour', updated_at=now()
      where id=r.id;
    end;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.process_due_scheduled_actions(integer) from public, anon, authenticated;

create or replace function public.update_loan_application_status(
  p_application_id uuid,
  p_status public.application_status,
  p_settlement_date date default null,
  p_client_note text default null
) returns table(application_id uuid, status public.application_status, status_updated_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_client_id uuid;
  v_client_user_id uuid;
  v_client_first text;
  v_broker_user_id uuid;
  v_broker_first text;
  v_old_status public.application_status;
  v_old_settlement_date date;
  v_reference text;
  v_description text;
  v_updated_at timestamptz := now();
  v_note text;
  v_subject text;
  v_title_t text;
  v_body_t text;
  v_title text;
  v_body text;
  v_push boolean := false;
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
  if v_note is not null and length(v_note) > 1000 then raise exception 'Client note is too long'; end if;
  if p_status = 'settled' and p_settlement_date is null then
    raise exception 'Settlement date is required when status is Settled';
  end if;

  update public.loan_applications la
  set status = p_status,
      client_note = v_note,
      settlement_date = case when p_status in ('settled','settlement_scheduled') then p_settlement_date else null end,
      settled_at = case
        when p_status='settled' and la.settled_at is null then v_updated_at
        when p_status='settled' then la.settled_at
        else null end,
      client_view_state = case when p_status='withdrawn' then 'past' else 'active' end,
      archived_at = case when p_status='withdrawn' then coalesce(la.archived_at,v_updated_at) else null end,
      status_updated_by_user_id=v_user_id,
      status_updated_at=v_updated_at,
      updated_at=v_updated_at
  where la.id=p_application_id;

  if v_old_status is distinct from p_status
     or v_old_settlement_date is distinct from p_settlement_date
     or v_note is not null then
    insert into public.application_status_history(
      application_id,organisation_id,client_id,from_status,to_status,
      client_note,changed_by_user_id,created_at
    ) values (
      p_application_id,v_org_id,v_client_id,v_old_status,p_status,
      v_note,v_user_id,v_updated_at
    );

    insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
    values (v_org_id,v_user_id,'loan_application_status_changed','loan_application',p_application_id,
      jsonb_build_object('client_id',v_client_id,'from_status',v_old_status,'to_status',p_status,
        'settlement_date',case when p_status in ('settlement_scheduled','settled') then p_settlement_date else null end));
  end if;

  v_broker_user_id := private.primary_broker_for_client(v_org_id,v_client_id);
  if v_broker_user_id is null then v_broker_user_id := v_user_id; end if;

  if p_status='settled' then
    perform private.schedule_settlement_actions(p_application_id,v_org_id,v_client_id,v_broker_user_id,p_settlement_date);
  elsif v_old_status='settled' and p_status<>'settled' then
    perform private.cancel_settlement_actions(p_application_id);
  end if;

  if v_old_status is distinct from p_status then
    select c.user_id,c.first_name into v_client_user_id,v_client_first
    from public.clients c where c.id=v_client_id and c.organisation_id=v_org_id;
    select p.first_name into v_broker_first from public.profiles p where p.id=v_broker_user_id;

    if v_client_user_id is not null then
      v_subject := coalesce(v_description,v_reference,'Your loan application');
      if p_status='settled' then
        select x.title_template,x.body_template into v_title_t,v_body_t
        from private.resolve_notification_template(v_org_id,v_broker_user_id,'settlement_confirmation','in_app') x;
        v_title := private.render_notification_template(v_title_t,v_client_first,v_broker_first,v_description);
        v_body := private.render_notification_template(v_body_t,v_client_first,v_broker_first,v_description);
        v_push := true;
      elsif p_status='formal_approval' then
        v_title := 'Congratulations!';
        v_body := 'Congratulations, '||coalesce(nullif(v_client_first,''),'there')||'! Your loan is fully approved.';
        v_push := true;
      elsif p_status='conditional_approval' then
        v_title := 'Good news!';
        v_body := 'Good news, '||coalesce(nullif(v_client_first,''),'there')||'! Your loan has received conditional approval.';
        v_push := true;
      elsif p_status='documents_required' then
        v_title := 'Action required';
        v_body := 'Your broker needs documents from you. Open AidezConnect for details.';
        v_push := true;
      else
        v_title := 'Loan application update';
        v_body := v_subject||' is now '||private.application_status_label(p_status)||'.';
        v_push := false;
      end if;

      insert into public.client_notifications(
        organisation_id,client_id,user_id,application_id,
        notification_type,title,body,data,push_eligible
      ) values (
        v_org_id,v_client_id,v_client_user_id,p_application_id,
        'application_status_changed',v_title,v_body,
        jsonb_build_object('application_id',p_application_id,'application_reference',v_reference,
          'application_description',v_description,'status',p_status),v_push
      );
    end if;
  end if;

  return query select p_application_id,p_status,v_updated_at;
end;
$$;

revoke all on function public.update_loan_application_status(uuid,public.application_status,date,text) from public, anon;
grant execute on function public.update_loan_application_status(uuid,public.application_status,date,text) to authenticated;

select cron.schedule(
  'aidezconnect-lifecycle-hourly',
  '5 * * * *',
  $$select public.process_due_scheduled_actions(100);$$
)
where not exists (select 1 from cron.job where jobname='aidezconnect-lifecycle-hourly');;
