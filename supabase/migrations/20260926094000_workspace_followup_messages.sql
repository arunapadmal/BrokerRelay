-- Broker workspace follow-up defaults and three-month lifecycle check-in.
-- Retain existing broker/company overrides; update only platform wording.
alter table public.notification_templates drop constraint if exists notification_templates_template_key_check;
alter table public.notification_templates add constraint notification_templates_template_key_check
  check (template_key in (
    'conditional_approval','formal_approval','settlement_scheduled',
    'settlement_confirmation','settlement_1_month','settlement_3_month',
    'settlement_6_month','settlement_12_month','settlement_annual'
  ));
alter table public.scheduled_actions drop constraint if exists scheduled_actions_action_type_check;
alter table public.scheduled_actions add constraint scheduled_actions_action_type_check
  check (action_type in (
    'settlement_1_month','settlement_3_month','settlement_6_month',
    'settlement_12_month','settlement_annual','auto_archive_90_days'
  ));

insert into public.notification_templates
(organisation_id, broker_user_id, template_key, channel, title_template, body_template)
values
(null,null,'conditional_approval','in_app','🎉 Conditional approval','Hi {{client_first_name}}, good news! Your {{application_description}} application has conditional approval. There may still be lender requirements to complete; I’ll guide you through the next steps. – {{broker_first_name}}'),
(null,null,'formal_approval','in_app','✅ Full approval','Hi {{client_first_name}}, your {{application_description}} application has received full approval! I’ll keep you updated as we prepare for settlement. – {{broker_first_name}}'),
(null,null,'settlement_scheduled','in_app','🏡 Settlement is coming up','Hi {{client_first_name}}, your {{application_description}} application is on its way to settlement. I’ll be in touch with the details and anything you need to prepare. – {{broker_first_name}}'),
(null,null,'settlement_confirmation','in_app','🔑 Your loan has settled','Congratulations, {{client_first_name}}! Your {{application_description}} loan has settled. Thank you for trusting me to help you get here. I’m here whenever you need support. – {{broker_first_name}}'),
(null,null,'settlement_1_month','in_app','👋 One-month check-in','Hi {{client_first_name}}, it has been a month since settlement. How is everything going with your new loan? If you have any questions, just reply here. – {{broker_first_name}}'),
(null,null,'settlement_3_month','in_app','📋 Three-month check-in','Hi {{client_first_name}}, three months have flown by! If you would like to check how your loan is working for you or talk through any questions, I’m here to help. – {{broker_first_name}}'),
(null,null,'settlement_6_month','in_app','🔎 Six-month loan review','Hi {{client_first_name}}, it has been six months since settlement. Would you like to review your loan and see whether it still suits your plans? Send me a message anytime. – {{broker_first_name}}'),
(null,null,'settlement_12_month','in_app','📅 Your first annual review','Hi {{client_first_name}}, it has been a year since settlement. Let’s check that your loan still suits your needs and goals. Reply here and we can arrange a review. – {{broker_first_name}}'),
(null,null,'settlement_annual','in_app','🔁 Time for your annual review','Hi {{client_first_name}}, it is time for your annual loan review. If your circumstances or plans have changed, let’s look at your options together. – {{broker_first_name}}')
on conflict (template_key,channel) where organisation_id is null and broker_user_id is null
  do update set title_template=excluded.title_template,body_template=excluded.body_template,updated_at=now();

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
      ('settlement_3_month'::text, interval '3 months'),
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
      'settlement_1_month','settlement_3_month','settlement_6_month','settlement_12_month',
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
  if p_template_key not in ('conditional_approval','formal_approval','settlement_scheduled','settlement_confirmation','settlement_1_month','settlement_3_month','settlement_6_month','settlement_12_month','settlement_annual') then
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

  foreach v_key in array array['conditional_approval','formal_approval','settlement_scheduled','settlement_confirmation','settlement_1_month','settlement_3_month','settlement_6_month','settlement_12_month','settlement_annual'] loop
    return query
      select v_key, r.title_template, r.body_template, r.template_source
      from private.resolve_notification_template(p_organisation_id, v_user_id, v_key, 'in_app') r;
  end loop;
end;
$$;

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
      if p_status in ('settled','formal_approval','conditional_approval','settlement_scheduled') then
        select x.title_template,x.body_template into v_title_t,v_body_t
        from private.resolve_notification_template(v_org_id,v_broker_user_id,
          case when p_status='settled' then 'settlement_confirmation' else p_status::text end,'in_app') x;
        v_title := private.render_notification_template(v_title_t,v_client_first,v_broker_first,v_description);
        v_body := private.render_notification_template(v_body_t,v_client_first,v_broker_first,v_description);
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
