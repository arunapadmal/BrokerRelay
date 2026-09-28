-- Record the related loan for a manual loan follow-up and its client notification.
alter table public.announcements add column if not exists application_id uuid references public.loan_applications(id) on delete set null;
create index if not exists announcements_application_idx on public.announcements(application_id) where application_id is not null;

create table if not exists public.company_message_templates (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  title_template text not null check (char_length(btrim(title_template)) between 2 and 120),
  body_template text not null check (char_length(btrim(body_template)) between 2 and 4000),
  created_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,organisation_id)
);
create index if not exists company_message_templates_org_idx on public.company_message_templates(organisation_id,name);
alter table public.company_message_templates enable row level security;
drop policy if exists company_message_templates_read on public.company_message_templates;
create policy company_message_templates_read on public.company_message_templates for select to authenticated
using (private.can_use_announcement_tools(organisation_id));
revoke all on public.company_message_templates from anon,authenticated;
grant select on public.company_message_templates to authenticated;

create or replace function public.save_company_message_template(
  p_organisation_id uuid,p_name text,p_title text,p_body text,p_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_user uuid:=auth.uid();
begin
  if v_user is null or not (
    private.is_head_broker(p_organisation_id,v_user)
    or private.has_staff_permission(p_organisation_id,'manage_company')
  ) then raise exception 'Company message management requires company permission'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 80
    or char_length(btrim(coalesce(p_title,''))) not between 2 and 120
    or char_length(btrim(coalesce(p_body,''))) not between 2 and 4000 then
    raise exception 'Check the name, title and message lengths';
  end if;
  if p_id is null then
    insert into public.company_message_templates(organisation_id,name,title_template,body_template,created_by_user_id)
    values(p_organisation_id,btrim(p_name),btrim(p_title),btrim(p_body),v_user) returning id into v_id;
  else
    update public.company_message_templates
    set name=btrim(p_name),title_template=btrim(p_title),body_template=btrim(p_body),updated_at=now()
    where id=p_id and organisation_id=p_organisation_id returning id into v_id;
    if v_id is null then raise exception 'Company message not found'; end if;
  end if;
  return v_id;
end;
$$;
create or replace function public.delete_company_message_template(p_organisation_id uuid,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not (
    private.is_head_broker(p_organisation_id,auth.uid())
    or private.has_staff_permission(p_organisation_id,'manage_company')
  ) then raise exception 'Company message management requires company permission'; end if;
  delete from public.company_message_templates where id=p_id and organisation_id=p_organisation_id;
end;
$$;
revoke all on function public.save_company_message_template(uuid,text,text,text,uuid) from public,anon;
revoke all on function public.delete_company_message_template(uuid,uuid) from public,anon;
grant execute on function public.save_company_message_template(uuid,text,text,text,uuid) to authenticated;
grant execute on function public.delete_company_message_template(uuid,uuid) to authenticated;

-- Existing general announcements continue through send_announcement_v2.
-- This wrapper validates the application and milestone again inside the transaction.
create or replace function public.send_loan_followup_announcement(
  p_organisation_id uuid,p_application_id uuid,p_template_key text,
  p_title text,p_body text,p_push_requested boolean default false,
  p_scope text default 'my_clients',p_lender_id uuid default null
) returns table(announcement_id uuid,recipient_count integer,connected_count integer)
language plpgsql security definer set search_path='' as $$
declare v_client_id uuid; v_status public.application_status; v_result record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select la.client_id,la.status into v_client_id,v_status
  from public.loan_applications la
  where la.id=p_application_id and la.organisation_id=p_organisation_id for update;
  if v_client_id is null or not private.can_manage_loan_application(p_organisation_id,v_client_id) then
    raise exception 'You do not have access to this client application';
  end if;
  if not (
    (v_status='conditional_approval' and p_template_key='conditional_approval')
    or (v_status='formal_approval' and p_template_key='formal_approval')
    or (v_status='settlement_scheduled' and p_template_key='settlement_scheduled')
    or (v_status='settled' and p_template_key in (
      'settlement_confirmation','settlement_1_month','settlement_3_month',
      'settlement_6_month','settlement_12_month','settlement_annual'))
  ) then raise exception 'This follow-up does not match the current application status'; end if;
  select * into v_result from public.send_announcement_v2(
    p_organisation_id,p_scope,p_title,p_body,p_push_requested,p_lender_id,array[v_client_id]
  );
  if v_result.recipient_count<>1 then raise exception 'A loan follow-up must have exactly one client'; end if;
  update public.announcements set application_id=p_application_id where id=v_result.announcement_id;
  update public.client_notifications
  set application_id=p_application_id,
      data=coalesce(data,'{}'::jsonb)||jsonb_build_object('application_id',p_application_id,'followup_key',p_template_key)
  where announcement_id=v_result.announcement_id and client_id=v_client_id;
  return query select v_result.announcement_id,v_result.recipient_count,v_result.connected_count;
end;
$$;
revoke all on function public.send_loan_followup_announcement(uuid,uuid,text,text,text,boolean,text,uuid) from public,anon;
grant execute on function public.send_loan_followup_announcement(uuid,uuid,text,text,text,boolean,text,uuid) to authenticated;
