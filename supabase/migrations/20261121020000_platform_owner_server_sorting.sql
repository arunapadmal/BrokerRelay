-- Stage 2: Platform Owner server-side ordering and pagination.
-- Existing owner-only dashboard / overview RPCs enforce authorisation.
-- Returns ordered page IDs; detail data remains provided by existing RPCs.
create or replace function public.platform_sorted_companies(
  p_search text default '', p_period text default 'all', p_page integer default 1,
  p_sort text default 'name', p_direction text default 'asc'
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_dashboard jsonb;
  v_all jsonb;
  v_month jsonb;
  v_search text := '%' || left(btrim(coalesce(p_search,'')),100) || '%';
  v_sort text := case when p_sort in ('name','head','phone','status','clients','applications','settlements') then p_sort else 'name' end;
  v_direction text := case when lower(p_direction)='desc' then 'desc' else 'asc' end;
  v_expr text;
  v_sql text;
  v_result jsonb;
  v_offset integer := (greatest(1,least(coalesce(p_page,1),100000))-1)*10;
begin
  -- SECURITY DEFINER callees validate the actual platform owner identity.
  v_dashboard := public.m7_admin_partner_dashboard();
  v_all := public.company_performance();
  v_month := public.company_performance_month();
  v_expr := case v_sort
    when 'head' then 'lower(coalesce(c.head_broker_name,'''') )'
    when 'phone' then 'coalesce(c.head_broker_mobile,'''')'
    when 'status' then 'c.status'
    when 'clients' then 'coalesce((metric->>''clients'')::bigint,-1)'
    when 'applications' then 'coalesce((metric->>''applications'')::bigint,-1)'
    when 'settlements' then 'coalesce(case when $3=''month'' then (metric->>''settled_month'')::bigint else (metric->''application_statuses''->>''settled'')::bigint end,-1)'
    else 'lower(c.name)' end;
  v_sql := 'with contacts as (
     select c.*,to_jsonb(c) as profile from public.platform_company_contact_overview_v2() c
   ), prepared as (
     select c.id,c.name,c.status,c.head_broker_name,c.head_broker_mobile,c.head_broker_email,
       case when $3=''month'' then (select value from jsonb_array_elements($5) value where value->>''organisation_id''=c.id::text limit 1)
            else (select value from jsonb_array_elements($4) value where value->>''organisation_id''=c.id::text limit 1) end metric,
       coalesce((select p->>''display_name'' from jsonb_array_elements($6->''partners'') p
         where p->>''id''=(select r->>''referring_partner_id'' from jsonb_array_elements($6->''referrals'') r
           where r->>''organisation_id''=c.id::text limit 1) limit 1),'''') referrer,
       coalesce((select p->>''display_name'' from jsonb_array_elements($6->''partners'') p
         where p->>''id''=(select r->>''assigned_account_manager_id'' from jsonb_array_elements($6->''referrals'') r
           where r->>''organisation_id''=c.id::text limit 1) limit 1),'''') manager
     from contacts c
   ), filtered as (
     select *,count(*) over() as total from prepared c
     where c.name ilike $1 or coalesce(c.head_broker_name,'''') ilike $1 or
       coalesce(c.head_broker_email,'''') ilike $1 or referrer ilike $1 or manager ilike $1
   ), ranked as (
     select id,total,row_number() over(order by '||v_expr||' '||v_direction||' nulls last,id asc) rn from filtered c
   ) select jsonb_build_object(
       ''ids'',coalesce((select jsonb_agg(id order by rn) from ranked where rn>$2 and rn<=$2+10),''[]''::jsonb),
       ''total'',coalesce((select max(total) from ranked),0),''page_size'',10)';
  execute v_sql into v_result using v_search,v_offset,case when p_period='month' then 'month' else 'all' end,v_all,v_month,v_dashboard;
  return v_result;
end $$;
revoke all on function public.platform_sorted_companies(text,text,integer,text,text) from public,anon;
grant execute on function public.platform_sorted_companies(text,text,integer,text,text) to authenticated;

create or replace function public.platform_sorted_partners(
  p_search text default '', p_status text default 'all', p_role text default 'all',
  p_agreement text default 'all', p_page integer default 1,
  p_sort text default 'name', p_direction text default 'asc'
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_dashboard jsonb := public.m7_admin_partner_dashboard();
  v_search text := '%' || left(btrim(coalesce(p_search,'')),100) || '%';
  v_sort text := case when p_sort in ('name','role','status','companies','managed','agreement') then p_sort else 'name' end;
  v_direction text := case when lower(p_direction)='desc' then 'desc' else 'asc' end;
  v_expr text;
  v_sql text;
  v_result jsonb;
  v_offset integer := (greatest(1,least(coalesce(p_page,1),100000))-1)*20;
begin
  v_expr := case v_sort
    when 'role' then 'role_label'
    when 'status' then 'status'
    when 'companies' then 'referred'
    when 'managed' then 'managed'
    when 'agreement' then 'agreement_label'
    else 'lower(display_name)' end;
  v_sql := 'with prepared as (
    select (p->>''id'')::uuid id,p->>''display_name'' display_name,p->>''contact_email'' contact_email,
      p->>''contact_mobile'' contact_mobile,p->>''partner_code'' partner_code,
      p->>''status'' status,coalesce((p->>''is_referrer'')::boolean,false) is_referrer,
      coalesce((p->>''is_account_manager'')::boolean,false) is_account_manager,
      trim(concat(case when coalesce((p->>''is_referrer'')::boolean,false) then ''referrer'' else '''' end,
                  '' '',case when coalesce((p->>''is_account_manager'')::boolean,false) then ''manager'' else '''' end)) role_label,
      case when p->>''agreement_accepted_at'' is not null then ''accepted''
           when p->>''current_offer_id'' is not null then ''pending'' else ''none'' end agreement_label,
      (select count(*) from jsonb_array_elements($6->''referrals'') r
        where r->>''referring_partner_id''=p->>''id'') referred,
      (select count(*) from jsonb_array_elements($6->''referrals'') r
        where r->>''assigned_account_manager_id''=p->>''id'') managed
      from jsonb_array_elements($6->''partners'') p
  ), filtered as (
    select *,count(*) over() total from prepared
    where (display_name ilike $1 or coalesce(contact_email,'''') ilike $1 or
       coalesce(contact_mobile,'''') ilike $1 or coalesce(partner_code,'''') ilike $1)
      and ($2=''all'' or status=$2)
      and ($3=''all'' or ($3=''referrer'' and is_referrer) or ($3=''manager'' and is_account_manager))
      and ($4=''all'' or ($4=''accepted'' and agreement_label=''accepted'')
        or ($4=''pending'' and agreement_label<>''accepted''))
  ), ranked as (
    select id,total,row_number() over(order by '||v_expr||' '||v_direction||' nulls last,id asc) rn from filtered
  ) select jsonb_build_object(
      ''ids'',coalesce((select jsonb_agg(id order by rn) from ranked where rn>$5 and rn<=$5+20),''[]''::jsonb),
      ''total'',coalesce((select max(total) from ranked),0),''page_size'',20)';
  execute v_sql into v_result using v_search,coalesce(p_status,'all'),coalesce(p_role,'all'),coalesce(p_agreement,'all'),v_offset,v_dashboard;
  return v_result;
end $$;
revoke all on function public.platform_sorted_partners(text,text,text,text,integer,text,text) from public,anon;
grant execute on function public.platform_sorted_partners(text,text,text,text,integer,text,text) to authenticated;
