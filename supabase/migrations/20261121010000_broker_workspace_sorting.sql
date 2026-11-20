-- Additive, read-only sorting API. Existing broker_workspace_search and CRM Import v5 remain unchanged.
-- SECURITY INVOKER means the existing client/application RLS policies continue to apply.
create or replace function public.broker_workspace_sorted(
 p_kind text, p_query text default '', p_status text default 'all',
 p_page integer default 1, p_sort text default 'client', p_direction text default 'asc'
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
 v_total bigint; v_items jsonb; v_offset integer := (greatest(1,least(coalesce(p_page,1),100000))-1)*20;
 v_query text := '%' || left(btrim(coalesce(p_query,'')),100) || '%';
 v_dir text := case when lower(p_direction)='desc' then 'desc' else 'asc' end;
 v_sort text;
 v_order text;
 v_sql text;
begin
 if auth.uid() is null then raise exception 'LOGIN_REQUIRED' using errcode='42501'; end if;
 if p_kind not in ('clients','applications') then raise exception 'UNKNOWN_WORKSPACE' using errcode='22023'; end if;
 v_sort := case when p_kind='clients' and p_sort in ('client','email','mobile','status','created','loan_count','settlement_date') then p_sort
                 when p_kind='applications' and p_sort in ('client','reference','lender','status','created','settlement_date') then p_sort
                 else 'client' end;
 if p_kind='clients' then
   select count(*) into v_total from public.clients c
   where concat_ws(' ',c.first_name,c.last_name,c.email,c.mobile) ilike v_query
     and (p_status='all' or c.status::text=p_status);
   v_order := case v_sort
     when 'client' then 'lower(c.first_name),lower(c.last_name)'
     when 'email' then 'lower(c.email)'
     when 'mobile' then 'c.mobile'
     when 'status' then 'c.status::text'
     when 'created' then 'c.created_at'
     when 'loan_count' then 'coalesce(loan.loan_count,0)'
     when 'settlement_date' then 'loan.latest_settlement'
   end;
   v_sql := 'select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from (
      select c.id,c.id as client_id,concat_ws('' '',c.first_name,c.last_name) as client,
       c.email as title,c.mobile,c.status::text as status,c.created_at as at_time,
       coalesce(loan.loan_count,0) as loan_count,loan.latest_settlement as settlement_date
      from public.clients c
      left join lateral (select count(*)::integer as loan_count,max(a.settlement_date) as latest_settlement
        from public.loan_applications a where a.client_id=c.id and a.organisation_id=c.organisation_id) loan on true
      where concat_ws('' '',c.first_name,c.last_name,c.email,c.mobile) ilike $1
        and ($2=''all'' or c.status::text=$2)
      order by ' || v_order || ' ' || v_dir || ' nulls last,c.id asc limit 20 offset $3) t';
 else
   select count(*) into v_total from public.loan_applications a
    join public.clients c on c.id=a.client_id
    left join public.lenders l on l.id=a.lender_id
    where concat_ws(' ',c.first_name,c.last_name,a.application_reference,a.application_description,l.name) ilike v_query
      and (p_status='all' or a.status::text=p_status);
   v_order := case v_sort
     when 'client' then 'lower(c.first_name),lower(c.last_name)'
     when 'reference' then 'lower(a.application_reference)'
     when 'lender' then 'lower(l.name)'
     when 'status' then 'a.status::text'
     when 'created' then 'a.created_at'
     when 'settlement_date' then 'a.settlement_date'
   end;
   v_sql := 'select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from (
      select a.id,a.client_id,concat_ws('' '',c.first_name,c.last_name) as client,
       a.client_view_state,a.application_reference as reference,a.application_description as title,
       a.status::text as status,l.name as lender,a.created_at as at_time,a.settlement_date
      from public.loan_applications a join public.clients c on c.id=a.client_id
      left join public.lenders l on l.id=a.lender_id
      where concat_ws('' '',c.first_name,c.last_name,a.application_reference,a.application_description,l.name) ilike $1
       and ($2=''all'' or a.status::text=$2)
      order by ' || v_order || ' ' || v_dir || ' nulls last,a.id asc limit 20 offset $3) t';
 end if;
 execute v_sql into v_items using v_query,p_status,v_offset;
 return jsonb_build_object('items',coalesce(v_items,'[]'::jsonb),'total',v_total,'page_size',20);
end $$;
revoke all on function public.broker_workspace_sorted(text,text,text,integer,text,text) from public,anon;
grant execute on function public.broker_workspace_sorted(text,text,text,integer,text,text) to authenticated;
