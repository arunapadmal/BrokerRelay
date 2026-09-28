create or replace function public.create_loan_application_v2(
  p_client_id uuid,
  p_application_reference text default null,
  p_application_description text default null,
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
  v_client_user_id uuid;
  v_org_id uuid;
  v_application_id uuid;
  v_created_at timestamptz;
  v_reference text;
  v_description text;
  v_note text;
  v_subject text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select c.organisation_id, c.user_id into v_org_id, v_client_user_id
  from public.clients c where c.id = p_client_id;

  if v_org_id is null or not private.can_manage_loan_application(v_org_id, p_client_id) then
    raise exception 'You do not have access to create an application for this client';
  end if;

  v_reference := nullif(btrim(p_application_reference), '');
  v_description := nullif(btrim(p_application_description), '');
  v_note := nullif(btrim(p_client_note), '');

  if v_description is not null and length(v_description) > 160 then
    raise exception 'Application description is too long';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'Client note is too long';
  end if;
  if p_status = 'settled' and p_settlement_date is null then
    raise exception 'Settlement date is required when status is Settled';
  end if;

  insert into public.loan_applications(
    organisation_id, client_id, application_reference, application_description,
    status, client_note, settlement_date, settled_at,
    created_by_user_id, status_updated_by_user_id
  ) values (
    v_org_id, p_client_id, v_reference, v_description,
    p_status, v_note, p_settlement_date,
    case when p_status='settled' then now() else null end,
    v_user_id, v_user_id
  ) returning id, public.loan_applications.created_at into v_application_id, v_created_at;

  insert into public.application_status_history(
    application_id, organisation_id, client_id, from_status, to_status,
    client_note, changed_by_user_id
  ) values (
    v_application_id, v_org_id, p_client_id, null, p_status, v_note, v_user_id
  );

  insert into public.audit_events(
    organisation_id, actor_user_id, event_type, entity_type, entity_id, metadata
  ) values (
    v_org_id, v_user_id, 'loan_application_created', 'loan_application', v_application_id,
    jsonb_build_object(
      'client_id', p_client_id,
      'status', p_status,
      'application_reference_present', v_reference is not null,
      'application_description_present', v_description is not null
    )
  );

  if v_client_user_id is not null then
    v_subject := coalesce(v_description, v_reference, 'A new loan application');
    insert into public.client_notifications(
      organisation_id, client_id, user_id, application_id,
      notification_type, title, body, data
    ) values (
      v_org_id, p_client_id, v_client_user_id, v_application_id,
      'application_created', 'New loan application',
      v_subject || ' has been added to AidezConnect.',
      jsonb_build_object(
        'application_id', v_application_id,
        'application_reference', v_reference,
        'application_description', v_description,
        'status', p_status
      )
    );
  end if;

  return query select v_application_id, p_status, v_created_at;
end;
$$;
revoke all on function public.create_loan_application_v2(uuid,text,text,public.application_status,date,text) from public, anon;
grant execute on function public.create_loan_application_v2(uuid,text,text,public.application_status,date,text) to authenticated;;
