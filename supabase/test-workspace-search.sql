-- Run after workspace-search.sql inside a rolled-back transaction.
select set_config('workspace.test_head_uid',(select id::text from auth.users where email='aruna@aidez.com.au'),true);
select set_config('workspace.test_broker_uid',(select id::text from auth.users where email='aidez.com.au@gmail.com'),true);
select set_config('workspace.test_owner_uid',(select user_id::text from public.platform_admins limit 1),true);
set local role authenticated;
do $$
declare who text;k text;r jsonb;page2 jsonb;visible bigint;
begin
 foreach who in array array[current_setting('workspace.test_head_uid'),current_setting('workspace.test_broker_uid')] loop
  perform set_config('request.jwt.claim.sub',who,true);
  foreach k in array array['clients','applications','messages','documents'] loop
   r:=public.broker_workspace_search(k,'','all',1);
   if jsonb_array_length(r->'items')>20 then raise exception 'Unbounded workspace results';end if;
   if exists(select 1 from jsonb_array_elements(r->'items') x where not exists(select 1 from public.clients c where c.id::text=x->>'client_id')) then raise exception 'Workspace bypassed client RLS';end if;
   page2:=public.broker_workspace_search(k,'','all',2);
   if exists(select 1 from jsonb_array_elements(r->'items') a join jsonb_array_elements(page2->'items') b on a->>'id'=b->>'id') then raise exception 'Pagination duplicates';end if;
   if jsonb_array_length(public.broker_workspace_search(k,'zzzz-no-matching-record-zzzz','all',1)->'items')<>0 then raise exception 'Search filter ignored';end if;
  end loop;
  select count(*) into visible from public.clients;
  r:=public.broker_workspace_search('clients','','all',1);
  if (r->>'total')::bigint<>visible then raise exception 'Client total does not match RLS';end if;
  begin perform public.platform_billing_delivery_history(1,'');raise exception 'Broker could read owner delivery history';exception when others then if sqlerrm<>'PLATFORM_OWNER_REQUIRED' then raise;end if;end;
 end loop;
 perform set_config('request.jwt.claim.sub',current_setting('workspace.test_owner_uid'),true);
 r:=public.platform_billing_delivery_history(1,'');
 if jsonb_array_length(r->'items')>20 or (r->>'total')::integer=0 then raise exception 'Owner history pagination failed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 foreach k in array array['clients','applications','messages','documents'] loop
  if (public.broker_workspace_search(k,'','all',1)->>'total')::integer<>0 then raise exception 'Unrelated identity saw records';end if;
 end loop;
end $$;
reset role;
