-- Read-only broker workspaces. SECURITY INVOKER preserves all existing RLS.
create or replace function public.broker_workspace_search(p_kind text,p_query text default '',p_status text default 'all',p_page integer default 1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;total bigint;start integer:=greatest(0,least(coalesce(p_page,1),100000)-1)*20;q text:='%'||left(btrim(coalesce(p_query,'')),100)||'%';
begin
 if auth.uid() is null then raise exception 'LOGIN_REQUIRED' using errcode='42501';end if;
 if p_kind='applications' then
  select count(*) into total from public.loan_applications a join public.clients c on c.id=a.client_id left join public.lenders l on l.id=a.lender_id where concat_ws(' ',c.first_name,c.last_name,a.application_reference,a.application_description,l.name) ilike q and (p_status='all' or a.status::text=p_status);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select a.id,a.client_id,c.first_name||' '||c.last_name as client,a.client_view_state,a.application_reference as reference,a.application_description as title,a.status::text as status,l.name as lender,a.created_at as at_time from public.loan_applications a join public.clients c on c.id=a.client_id left join public.lenders l on l.id=a.lender_id where concat_ws(' ',c.first_name,c.last_name,a.application_reference,a.application_description,l.name) ilike q and (p_status='all' or a.status::text=p_status) order by a.created_at desc,a.id offset start limit 20)x;
 elsif p_kind='documents' then
  select count(*) into total from public.document_requests d join public.clients c on c.id=d.client_id left join public.loan_applications a on a.id=d.application_id where concat_ws(' ',c.first_name,c.last_name,d.title,a.application_reference) ilike q and (p_status='all' or p_status='pending' and d.status::text in('requested','upload_in_progress','relay_processing','failed') or d.status::text=p_status);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select d.id,d.client_id,c.first_name||' '||c.last_name as client,d.title,d.status::text as status,a.application_reference as reference,d.requested_at as at_time from public.document_requests d join public.clients c on c.id=d.client_id left join public.loan_applications a on a.id=d.application_id where concat_ws(' ',c.first_name,c.last_name,d.title,a.application_reference) ilike q and (p_status='all' or p_status='pending' and d.status::text in('requested','upload_in_progress','relay_processing','failed') or d.status::text=p_status) order by d.requested_at desc,d.id offset start limit 20)x;
 elsif p_kind='messages' then
  select count(*) into total from public.conversations v join public.clients c on c.id=v.client_id left join public.get_my_unread_counts() u on u.conversation_id=v.id where concat_ws(' ',c.first_name,c.last_name,c.email) ilike q and (p_status='all' or p_status='unread' and coalesce(u.unread_count,0)>0);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select v.id,v.client_id,c.first_name||' '||c.last_name as client,c.email as title,v.last_message_at as at_time,coalesce(u.unread_count,0) as unread from public.conversations v join public.clients c on c.id=v.client_id left join public.get_my_unread_counts() u on u.conversation_id=v.id where concat_ws(' ',c.first_name,c.last_name,c.email) ilike q and (p_status='all' or p_status='unread' and coalesce(u.unread_count,0)>0) order by v.last_message_at desc nulls last,v.id offset start limit 20)x;
 elsif p_kind='clients' then
  select count(*) into total from public.clients c where concat_ws(' ',c.first_name,c.last_name,c.email,c.mobile) ilike q and (p_status='all' or c.status::text=p_status);
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select c.id,c.id as client_id,c.first_name||' '||c.last_name as client,c.email as title,c.mobile,c.status::text as status,c.created_at as at_time from public.clients c where concat_ws(' ',c.first_name,c.last_name,c.email,c.mobile) ilike q and (p_status='all' or c.status::text=p_status) order by c.first_name,c.last_name,c.id offset start limit 20)x;
 else raise exception 'UNKNOWN_WORKSPACE';end if;
 return jsonb_build_object('items',rows,'total',total,'page_size',20);
end $$;
revoke all on function public.broker_workspace_search(text,text,text,integer) from public,anon;
grant execute on function public.broker_workspace_search(text,text,text,integer) to authenticated;

-- Owner delivery history exposes display metadata only. No token, destination,
-- provider credential or delivery mutation privileges are granted.
grant select(state,attempts,error_code,first_attempt_at,available_at) on public.billing_delivery_jobs to authenticated;
drop policy if exists platform_owner_delivery_metadata on public.billing_delivery_jobs;
create policy platform_owner_delivery_metadata on public.billing_delivery_jobs for select to authenticated using(exists(select 1 from public.platform_admins a where a.user_id=(select auth.uid())));
-- SECURITY INVOKER retains the owner-only row policy and column restrictions.
create or replace function public.platform_billing_delivery_history(p_page integer default 1,p_query text default '') returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;total bigint;q text:='%'||left(btrim(coalesce(p_query,'')),100)||'%';
begin
 if auth.uid() is null or not exists(select 1 from public.platform_admins where user_id=auth.uid()) then raise exception 'PLATFORM_OWNER_REQUIRED' using errcode='42501';end if;
 select count(*) into total from public.billing_delivery_jobs j join public.billing_invoices i on i.id=j.invoice_id where concat_ws(' ',i.invoice_number,i.company_snapshot->>'name',j.kind,j.state) ilike q;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into rows from(select j.id,i.invoice_number,i.company_snapshot->>'name' as company,j.kind,j.state,j.attempts,j.error_code,j.first_attempt_at as at_time from public.billing_delivery_jobs j join public.billing_invoices i on i.id=j.invoice_id where concat_ws(' ',i.invoice_number,i.company_snapshot->>'name',j.kind,j.state) ilike q order by j.available_at desc,j.id offset greatest(0,least(coalesce(p_page,1),100000)-1)*20 limit 20)x;
 return jsonb_build_object('items',rows,'total',total);
end $$;
revoke all on function public.platform_billing_delivery_history(integer,text) from public,anon;
grant execute on function public.platform_billing_delivery_history(integer,text) to authenticated;
