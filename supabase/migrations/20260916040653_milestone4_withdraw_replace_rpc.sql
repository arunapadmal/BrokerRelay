create or replace function public.withdraw_and_create_replacement_application(
  p_application_id uuid,
  p_new_application_reference text default null,
  p_new_application_description text default null,
  p_withdrawal_note text default 'A replacement lender application has been started.'
) returns table(old_application_id uuid, new_application_id uuid)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_client_id uuid;
  v_old_status public.application_status;
  v_new_id uuid;
  v_reference text := nullif(btrim(p_new_application_reference),'');
  v_description text := nullif(btrim(p_new_application_description),'');
  v_note text := coalesce(nullif(btrim(p_withdrawal_note),''),'A replacement lender application has been started.');
  v_client_user_id uuid;
  v_client_first text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_description is not null and length(v_description)>160 then raise exception 'Application description is too long'; end if;
  if length(v_note)>1000 then raise exception 'Withdrawal note is too long'; end if;

  select la.organisation_id,la.client_id,la.status
    into v_org_id,v_client_id,v_old_status
  from public.loan_applications la
  where la.id=p_application_id
  for update;

  if v_org_id is null or not private.can_manage_loan_application(v_org_id,v_client_id) then
    raise exception 'You do not have access to this application';
  end if;
  if v_old_status='settled' then
    raise exception 'A settled application cannot be replaced through this workflow';
  end if;

  update public.loan_applications
  set status='withdrawn', client_note=v_note, client_view_state='past',
      archived_at=coalesce(archived_at,now()), status_updated_by_user_id=v_user_id,
      status_updated_at=now(), updated_at=now()
  where id=p_application_id;

  insert into public.application_status_history(
    application_id,organisation_id,client_id,from_status,to_status,
    client_note,changed_by_user_id,created_at
  ) values (p_application_id,v_org_id,v_client_id,v_old_status,'withdrawn',v_note,v_user_id,now());

  perform private.cancel_settlement_actions(p_application_id);

  insert into public.loan_applications(
    organisation_id,client_id,application_reference,application_description,
    status,client_note,created_by_user_id,status_updated_by_user_id,
    client_view_state
  ) values (
    v_org_id,v_client_id,v_reference,v_description,'preparing_application',
    'Your replacement mortgage application is being prepared.',v_user_id,v_user_id,'active'
  ) returning id into v_new_id;

  insert into public.application_status_history(
    application_id,organisation_id,client_id,from_status,to_status,
    client_note,changed_by_user_id,created_at
  ) values (
    v_new_id,v_org_id,v_client_id,null,'preparing_application',
    'Your replacement mortgage application is being prepared.',v_user_id,now()
  );

  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values (
    v_org_id,v_user_id,'loan_application_replaced','loan_application',p_application_id,
    jsonb_build_object('client_id',v_client_id,'replacement_application_id',v_new_id)
  );

  select c.user_id,c.first_name into v_client_user_id,v_client_first
  from public.clients c where c.id=v_client_id and c.organisation_id=v_org_id;
  if v_client_user_id is not null then
    insert into public.client_notifications(
      organisation_id,client_id,user_id,application_id,notification_type,title,body,data,push_eligible
    ) values (
      v_org_id,v_client_id,v_client_user_id,v_new_id,'replacement_application_created',
      'New loan application','A replacement loan application has been started in AidezConnect.',
      jsonb_build_object('old_application_id',p_application_id,'application_id',v_new_id),false
    );
  end if;

  return query select p_application_id,v_new_id;
end;
$$;

revoke all on function public.withdraw_and_create_replacement_application(uuid,text,text,text) from public,anon;
grant execute on function public.withdraw_and_create_replacement_application(uuid,text,text,text) to authenticated;;
