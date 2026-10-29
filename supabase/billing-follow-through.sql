begin;
alter table public.billing_invoice_commissions add column if not exists refund_deducted_cents integer not null default 0 check(refund_deducted_cents>=0);
alter table public.billing_invoice_commissions drop constraint if exists billing_invoice_commissions_status_check;
alter table public.billing_invoice_commissions add constraint billing_invoice_commissions_status_check check(status in ('eligible','reversed'));
create table public.billing_invoice_refunds (
 invoice_id uuid primary key references public.billing_invoices(id),
 charge_id text not null unique,refunded_cents integer not null check(refunded_cents>=0),
 currency text not null check(currency='aud'),updated_at timestamptz not null default now()
);
create table public.billing_sandbox_actions (
 id uuid primary key,invoice_id uuid not null references public.billing_invoices(id),
 owner_id uuid not null references auth.users(id),kind text not null check(kind in ('retry','refund')),
 amount_cents integer not null default 0 check(amount_cents>=0),provider_id text,
 created_at timestamptz not null default now()
);
create table public.billing_sandbox_email_deliveries (
 job_id uuid primary key references public.billing_delivery_jobs(id),
 owner_id uuid not null references auth.users(id),recipient text not null,
 provider_id text not null,accepted_at timestamptz not null default now()
);
alter table public.billing_invoice_refunds enable row level security;
alter table public.billing_sandbox_actions enable row level security;
alter table public.billing_sandbox_email_deliveries enable row level security;
revoke all on public.billing_invoice_refunds,public.billing_sandbox_actions,public.billing_sandbox_email_deliveries from public,anon,authenticated;
grant all on public.billing_invoice_refunds,public.billing_sandbox_actions,public.billing_sandbox_email_deliveries to service_role;
grant select on public.billing_invoice_refunds,public.billing_sandbox_actions,public.billing_sandbox_email_deliveries to authenticated;
create policy refund_invoice_reader on public.billing_invoice_refunds for select to authenticated using(invoice_id in (select id from public.billing_invoices));
create policy sandbox_action_owner on public.billing_sandbox_actions for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.platform_admins where user_id=(select auth.uid())));
create policy sandbox_email_owner on public.billing_sandbox_email_deliveries for select to authenticated using(owner_id=(select auth.uid()) and exists(select 1 from public.platform_admins where user_id=(select auth.uid())));
create function public.billing_reconcile_sandbox_refund(p_event text,p_invoice uuid,p_intent text,p_charge text,p_customer text,p_amount integer,p_refunded integer,p_currency text,p_live boolean) returns void language plpgsql security invoker set search_path='' as $$
declare i public.billing_invoices%rowtype;c public.billing_invoice_payment_context%rowtype;previous integer;
begin
 select * into strict i from public.billing_invoices where id=p_invoice for update;
 select * into strict c from public.billing_invoice_payment_context where invoice_id=p_invoice for update;
 if p_live is distinct from false or p_currency is distinct from 'aud' or p_amount is distinct from i.total_cents or p_intent is distinct from c.intent_id or p_customer is distinct from c.customer_id or p_refunded is null or p_refunded<0 or p_refunded>p_amount or nullif(p_charge,'') is null or nullif(p_event,'') is null then raise exception 'REFUND_MISMATCH';end if;
 if i.status<>'paid' then raise exception 'PAYMENT_NOT_YET_RECONCILED';end if;
 insert into public.billing_stripe_events(id) values(p_event) on conflict do nothing;if not found then return;end if;
 select refunded_cents into previous from public.billing_invoice_refunds where invoice_id=i.id;
 if p_refunded<=coalesce(previous,0) then return;end if;
 insert into public.billing_invoice_refunds(invoice_id,charge_id,refunded_cents,currency) values(i.id,p_charge,p_refunded,'aud')
 on conflict(invoice_id) do update set refunded_cents=excluded.refunded_cents,updated_at=now();
 -- Preserve original tax invoice and receipt; refund is a separate financial adjustment.
 update public.billing_invoice_commissions set refund_deducted_cents=case when p_refunded=p_amount then commission_cents else round(commission_cents::numeric*p_refunded/p_amount)::integer end,
 status=case when p_refunded=p_amount then 'reversed' else 'eligible' end where invoice_id=i.id;
 update public.billing_invoices set payment_status=case when p_refunded=p_amount then 'refunded' else 'partially_refunded' end where id=i.id;
 insert into public.audit_events(organisation_id,event_type,entity_type,entity_id,metadata) values(i.organisation_id,'sandbox_invoice_refund','billing_invoice',i.id,jsonb_build_object('refunded_cents',p_refunded,'mode','sandbox','charge',p_charge));
end $$;
create function public.billing_claim_sandbox_email(p_invoice uuid,p_kind text,p_owner uuid,p_lease uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.billing_delivery_jobs%rowtype;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_owner) or p_kind not in ('receipt_email','failure_email') then raise exception 'OWNER_AND_EMAIL_KIND_REQUIRED';end if;
 if not exists(select 1 from public.billing_invoice_payment_context where invoice_id=p_invoice) then raise exception 'SANDBOX_INVOICE_REQUIRED';end if;
 if p_kind='receipt_email' and not exists(select 1 from public.billing_invoice_receipts where invoice_id=p_invoice) then raise exception 'RECEIPT_REQUIRED';end if;
 select * into strict j from public.billing_delivery_jobs where invoice_id=p_invoice and kind=p_kind for update;
 if exists(select 1 from public.billing_sandbox_email_deliveries where job_id=j.id) then raise exception 'TEST_EMAIL_ALREADY_ACCEPTED';end if;
 if j.state='working' and j.lease_until>now() then raise exception 'EMAIL_ALREADY_PROCESSING';end if;
 if j.error_code is distinct from 'SANDBOX_EMAIL_HELD' or (j.first_attempt_at is not null and now()-j.first_attempt_at>interval '20 hours') then raise exception 'EMAIL_REVIEW_REQUIRED';end if;
 update public.billing_delivery_jobs set state='working',lease_token=p_lease,lease_until=now()+interval '2 minutes',first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1 where id=j.id returning * into j;
 return to_jsonb(j);
end $$;
revoke all on function public.billing_reconcile_sandbox_refund(text,uuid,text,text,text,integer,integer,text,boolean),public.billing_claim_sandbox_email(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.billing_reconcile_sandbox_refund(text,uuid,text,text,text,integer,integer,text,boolean),public.billing_claim_sandbox_email(uuid,text,uuid,uuid) to service_role;
commit;
do $$
declare d text; old_condition text:='WHERE j.state=''review'' OR (j.state IN (''pending'',''working'') AND j.available_at<now()-interval ''1 hour'' AND (j.lease_until IS NULL OR j.lease_until<now()))';
begin
 d:=pg_get_functiondef('private.platform_operations()'::regprocedure);
 if position('sandbox_held_count' in d)=0 then
  if position(old_condition in d)=0 then raise exception 'OPERATIONS_BASELINE_CHANGED';end if;
  d:=replace(d,old_condition,'WHERE ('||substring(old_condition from 7)||') AND j.error_code IS DISTINCT FROM ''SANDBOX_EMAIL_HELD''');
  d:=replace(d,'jsonb_build_object(''checked_at'',now()','jsonb_build_object(''sandbox_held_count'',(SELECT count(*) FROM public.billing_delivery_jobs WHERE state=''review'' AND error_code=''SANDBOX_EMAIL_HELD''),''checked_at'',now()');
  execute d;
 end if;
end $$;
begin;
alter table public.billing_invoice_payment_context add column scheduled boolean not null default false;
alter table public.billing_invoice_payment_context add column collection_started_at timestamptz;
alter table public.billing_invoice_payment_context add column collection_lease_until timestamptz;
alter table public.billing_invoice_payment_context add column collection_token uuid;
create function public.billing_claim_sandbox_collection(p_invoice uuid,p_token uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.billing_invoices%rowtype;c public.billing_invoice_payment_context%rowtype;a public.billing_payment_accounts%rowtype;
begin
 select * into strict i from public.billing_invoices where id=p_invoice for update;
 select * into strict c from public.billing_invoice_payment_context where invoice_id=i.id for update;
 if not c.scheduled or c.intent_id is not null or i.status<>'issued' then return null;end if;
 if i.invoice_email_sent_at is null or i.debit_at>now() or i.invoice_email_sent_at>now()-interval '7 days' then return null;end if;
 if c.collection_lease_until>now() then return null;end if;
 if c.collection_started_at<now()-interval '20 hours' then raise exception 'COLLECTION_RECONCILIATION_REVIEW_REQUIRED';end if;
 select * into strict a from public.billing_payment_accounts where organisation_id=i.organisation_id;
 if a.livemode or not a.ready or not a.enabled or a.stripe_customer_id is distinct from c.customer_id or a.stripe_mandate_id is distinct from i.notified_mandate_id then raise exception 'TEST_MANDATE_REVIEW_REQUIRED';end if;
 if not exists(select 1 from public.billing_automation_settings where id and debit_enabled) then return null;end if;
 update public.billing_invoice_payment_context set collection_started_at=coalesce(collection_started_at,now()),collection_lease_until=now()+interval '2 minutes',collection_token=p_token where invoice_id=i.id;
 return jsonb_build_object('invoice',to_jsonb(i),'account',to_jsonb(a));
end $$;
revoke all on function public.billing_claim_sandbox_collection(uuid,uuid) from public,anon,authenticated;
grant execute on function public.billing_claim_sandbox_collection(uuid,uuid) to service_role;
commit;
do $$
declare d text;
begin
 d:=pg_get_functiondef('public.billing_claim_sandbox_email(uuid,text,uuid,uuid)'::regprocedure);
 d:=replace(d,'p_kind not in (''receipt_email'',''failure_email'')','p_kind not in (''invoice_email'',''receipt_email'',''failure_email'')');
 execute d;
 d:=pg_get_functiondef('public.billing_claim_sandbox_collection(uuid,uuid)'::regprocedure);
 d:=replace(d,'if not c.scheduled', 'if c.invoice_hash<>md5(jsonb_build_array(i.organisation_id,i.cycle_id,i.month,i.issued_at,i.lines,i.subtotal_cents,i.gst_cents,i.total_cents,i.company_snapshot,i.supplier_snapshot)::text) then raise exception ''INVOICE_CHANGED'';end if; if not c.scheduled');
 execute d;
end $$;
do $$
declare d text;guard text:='  if not exists(select 1 from public.billing_invoice_payment_context where invoice_id=i.id and customer_id=p_customer) then raise exception ''CUSTOMER_MISMATCH''; end if;';
begin
 d:=pg_get_functiondef('public.billing_register_sandbox_invoice(uuid,text,uuid)'::regprocedure);
 if position('REGISTERED_INVOICE_CHANGED' in d)=0 then
  if position(guard in d)=0 then raise exception 'REGISTRAR_BASELINE_CHANGED';end if;
  d:=replace(d,guard,guard||' if exists(select 1 from public.billing_invoice_payment_context c where c.invoice_id=i.id and c.invoice_hash<>md5(jsonb_build_array(i.organisation_id,i.cycle_id,i.month,i.issued_at,i.lines,i.subtotal_cents,i.gst_cents,i.total_cents,i.company_snapshot,i.supplier_snapshot)::text)) then raise exception ''REGISTERED_INVOICE_CHANGED'';end if;');execute d;
 end if;
end $$;
