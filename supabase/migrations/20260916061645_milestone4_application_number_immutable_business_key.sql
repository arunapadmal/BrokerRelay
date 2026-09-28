create or replace function private.enforce_application_number()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op = 'INSERT' then
    new.application_reference := nullif(btrim(new.application_reference),'');
    if new.application_reference is null then
      raise exception 'Application number is required';
    end if;
    return new;
  end if;

  if old.application_reference is not null then
    if new.application_reference is distinct from old.application_reference then
      raise exception 'Application number cannot be changed after the application is created';
    end if;
  elsif new.application_reference is not null then
    new.application_reference := nullif(btrim(new.application_reference),'');
    if new.application_reference is null then
      raise exception 'Application number cannot be blank';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_application_number() from public, anon, authenticated;

drop trigger if exists trg_loan_applications_application_number on public.loan_applications;
create trigger trg_loan_applications_application_number
before insert or update of application_reference on public.loan_applications
for each row execute function private.enforce_application_number();

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
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_client_user_id uuid;
  v_org_id uuid;
  v_application_id uuid;
  v_created_at timestamptz;
  v_reference text := nullif(btrim(p_application_reference),'');
  v_description text := nullif(btrim(p_application_description),'');
  v_note text := nullif(btrim(p_client_note),'');
  v_subject text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_reference is null then raise exception 'Application number is required'; end if;

  select c.organisation_id,c.user_id into v_org_id,v_client_user_id
  from public.clients c where c.id=p_client_id;

  if v_org_id is null or not private.can_manage_loan_application(v_org_id,p_client_id) then
    raise exception 'You do not have access to create an application for this client';
  end if;

  if exists(
    select 1 from public.loan_applications la
    where la.organisation_id=v_org_id and lower(la.application_reference)=lower(v_reference)
  ) then
    raise exception 'Application number % is already in use. Enter the new lender/CRM application number.',v_reference;
  end if;
  if v_description is not null and length(v_description)>160 then raise exception 'Application description is too long'; end if;
  if v_note is not null and length(v_note)>1000 then raise exception 'Client note is too long'; end if;
  if p_status='settled' and p_settlement_date is null then raise exception 'Settlement date is required when status is Settled'; end if;

  insert into public.loan_applications(
    organisation_id,client_id,application_reference,application_description,status,client_note,
    settlement_date,settled_at,created_by_user_id,status_updated_by_user_id
  ) values (
    v_org_id,p_client_id,v_reference,v_description,p_status,v_note,p_settlement_date,
    case when p_status='settled' then now() else null end,v_user_id,v_user_id
  ) returning id,public.loan_applications.created_at into v_application_id,v_created_at;

  insert into public.application_status_history(
    application_id,organisation_id,client_id,from_status,to_status,client_note,changed_by_user_id
  ) values(v_application_id,v_org_id,p_client_id,null,p_status,v_note,v_user_id);

  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(v_org_id,v_user_id,'loan_application_created','loan_application',v_application_id,
    jsonb_build_object('client_id',p_client_id,'status',p_status,'application_number',v_reference,'application_description_present',v_description is not null));

  if v_client_user_id is not null then
    v_subject := coalesce(v_description,v_reference,'A new loan application');
    insert into public.client_notifications(
      organisation_id,client_id,user_id,application_id,notification_type,title,body,data
    ) values(
      v_org_id,p_client_id,v_client_user_id,v_application_id,'application_created','New loan application',
      v_subject||' has been added to AidezConnect.',
      jsonb_build_object('application_id',v_application_id,'application_number',v_reference,'application_description',v_description,'status',p_status)
    );
  end if;

  return query select v_application_id,p_status,v_created_at;
end;
$$;

create or replace function public.update_loan_application_details(
  p_application_id uuid,
  p_application_reference text default null,
  p_application_description text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_client_id uuid;
  v_existing_reference text;
  v_reference text := nullif(btrim(p_application_reference),'');
  v_description text := nullif(btrim(p_application_description),'');
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select la.organisation_id,la.client_id,la.application_reference
    into v_org_id,v_client_id,v_existing_reference
  from public.loan_applications la
  where la.id=p_application_id
  for update;

  if v_org_id is null or not private.can_manage_loan_application(v_org_id,v_client_id) then
    raise exception 'You do not have access to update this application';
  end if;
  if v_description is not null and length(v_description)>160 then raise exception 'Application description is too long'; end if;

  if v_existing_reference is null then
    if v_reference is null then raise exception 'Application number is required'; end if;
    if exists(select 1 from public.loan_applications la where la.organisation_id=v_org_id and la.id<>p_application_id and lower(la.application_reference)=lower(v_reference)) then
      raise exception 'Application number % is already in use',v_reference;
    end if;
  elsif v_reference is distinct from v_existing_reference then
    raise exception 'Application number cannot be changed after it is created';
  end if;

  update public.loan_applications
  set application_reference=coalesce(v_existing_reference,v_reference),
      application_description=v_description,
      updated_at=now()
  where id=p_application_id;

  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(v_org_id,v_user_id,'loan_application_description_updated','loan_application',p_application_id,
    jsonb_build_object('client_id',v_client_id,'application_number',coalesce(v_existing_reference,v_reference),'application_description_present',v_description is not null));
end;
$$;

create or replace function public.withdraw_and_create_replacement_application(
  p_application_id uuid,
  p_new_application_reference text default null,
  p_new_application_description text default null,
  p_withdrawal_note text default 'A replacement lender application has been started.'
)
returns table(old_application_id uuid,new_application_id uuid)
language plpgsql
security definer
set search_path=''
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
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if v_reference is null then raise exception 'New application number is required for a replacement application'; end if;
  if v_description is not null and length(v_description)>160 then raise exception 'Application description is too long'; end if;
  if length(v_note)>1000 then raise exception 'Withdrawal note is too long'; end if;

  select la.organisation_id,la.client_id,la.status into v_org_id,v_client_id,v_old_status
  from public.loan_applications la where la.id=p_application_id for update;

  if v_org_id is null or not private.can_manage_loan_application(v_org_id,v_client_id) then raise exception 'You do not have access to this application'; end if;
  if v_old_status='settled' then raise exception 'A settled application cannot be replaced through this workflow'; end if;
  if exists(select 1 from public.loan_applications la where la.organisation_id=v_org_id and lower(la.application_reference)=lower(v_reference)) then
    raise exception 'Application number % is already in use. Enter the new lender/CRM application number.',v_reference;
  end if;

  update public.loan_applications
  set status='withdrawn',client_note=v_note,client_view_state='past',archived_at=coalesce(archived_at,now()),
      status_updated_by_user_id=v_user_id,status_updated_at=now(),updated_at=now()
  where id=p_application_id;

  insert into public.application_status_history(application_id,organisation_id,client_id,from_status,to_status,client_note,changed_by_user_id,created_at)
  values(p_application_id,v_org_id,v_client_id,v_old_status,'withdrawn',v_note,v_user_id,now());
  perform private.cancel_settlement_actions(p_application_id);

  insert into public.loan_applications(
    organisation_id,client_id,application_reference,application_description,status,client_note,
    created_by_user_id,status_updated_by_user_id,client_view_state
  ) values(
    v_org_id,v_client_id,v_reference,v_description,'preparing_application','Your replacement mortgage application is being prepared.',
    v_user_id,v_user_id,'active'
  ) returning id into v_new_id;

  insert into public.application_status_history(application_id,organisation_id,client_id,from_status,to_status,client_note,changed_by_user_id,created_at)
  values(v_new_id,v_org_id,v_client_id,null,'preparing_application','Your replacement mortgage application is being prepared.',v_user_id,now());

  insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata)
  values(v_org_id,v_user_id,'loan_application_replaced','loan_application',p_application_id,
    jsonb_build_object('client_id',v_client_id,'replacement_application_id',v_new_id,'replacement_application_number',v_reference));

  select c.user_id into v_client_user_id from public.clients c where c.id=v_client_id and c.organisation_id=v_org_id;
  if v_client_user_id is not null then
    insert into public.client_notifications(organisation_id,client_id,user_id,application_id,notification_type,title,body,data,push_eligible)
    values(v_org_id,v_client_id,v_client_user_id,v_new_id,'replacement_application_created','New loan application',
      'A replacement loan application has been started in AidezConnect.',
      jsonb_build_object('old_application_id',p_application_id,'application_id',v_new_id,'application_number',v_reference),false);
  end if;

  return query select p_application_id,v_new_id;
end;
$$;

grant execute on function public.create_loan_application_v2(uuid,text,text,public.application_status,date,text) to authenticated;
grant execute on function public.update_loan_application_details(uuid,text,text) to authenticated;
grant execute on function public.withdraw_and_create_replacement_application(uuid,text,text,text) to authenticated;
revoke execute on function public.create_loan_application_v2(uuid,text,text,public.application_status,date,text) from public,anon;
revoke execute on function public.update_loan_application_details(uuid,text,text) from public,anon;
revoke execute on function public.withdraw_and_create_replacement_application(uuid,text,text,text) from public,anon;;
