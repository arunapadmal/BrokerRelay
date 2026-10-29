-- Development sandbox only. No live collection or outbound email is enabled.
begin;
alter table public.billing_one_time_charges add column if not exists fee_category text not null default 'unclassified';
create table public.billing_invoice_payment_context (
 invoice_id uuid primary key references public.billing_invoices(id),
 customer_id text not null, intent_id text unique,
 mode text not null default 'sandbox' check(mode='sandbox'),
 invoice_hash text not null,
 partner_id uuid references public.m7_partner_accounts(id),
 beneficiary_user_id uuid references auth.users(id),
 offer_id uuid references private.partner_offer_versions(id),
 eligible_base_cents integer not null check(eligible_base_cents>=0),
 rate_bps integer not null check(rate_bps between 0 and 10000),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create table public.billing_invoice_receipts (
 invoice_id uuid primary key references public.billing_invoices(id),
 receipt_number text not null unique,
 mode text not null check(mode='sandbox'),
 snapshot jsonb not null,created_at timestamptz not null default now()
);
create table public.billing_invoice_commissions (
 invoice_id uuid primary key references public.billing_invoices(id),
 partner_id uuid not null references public.m7_partner_accounts(id),
 beneficiary_user_id uuid not null references auth.users(id),
 offer_id uuid not null references private.partner_offer_versions(id),
 eligible_base_cents integer not null check(eligible_base_cents>0),
 rate_bps integer not null check(rate_bps between 0 and 10000),
 commission_cents integer not null check(commission_cents>=0),
 mode text not null check(mode='sandbox'),
 status text not null default 'eligible' check(status='eligible'),
 created_at timestamptz not null default now()
);
alter table public.billing_invoice_payment_context enable row level security;
alter table public.billing_invoice_receipts enable row level security;
alter table public.billing_invoice_commissions enable row level security;
revoke all on public.billing_invoice_payment_context,public.billing_invoice_receipts,public.billing_invoice_commissions from public,anon,authenticated;
grant select on public.billing_invoice_payment_context,public.billing_invoice_receipts,public.billing_invoice_commissions to authenticated;
grant all on public.billing_invoice_payment_context,public.billing_invoice_receipts,public.billing_invoice_commissions to service_role;
create policy invoice_context_read on public.billing_invoice_payment_context for select to authenticated using (invoice_id in (select id from public.billing_invoices));
create policy invoice_receipt_read on public.billing_invoice_receipts for select to authenticated using (invoice_id in (select id from public.billing_invoices));
create policy invoice_commission_read on public.billing_invoice_commissions for select to authenticated using (beneficiary_user_id=(select auth.uid()) or exists(select 1 from public.platform_admins where user_id=(select auth.uid())));
create or replace function public.billing_register_sandbox_invoice(p_invoice uuid,p_customer text,p_owner uuid) returns void language plpgsql security invoker set search_path='' as $$
declare i public.billing_invoices%rowtype; offer record; base integer:=0; fingerprint text;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select * into strict i from public.billing_invoices where id=p_invoice for update;
 if i.status<>'issued' or i.stripe_payment_intent_id is not null then raise exception 'UNPAID_UNSUBMITTED_INVOICE_REQUIRED'; end if;
 if i.total_cents<=0 or i.total_cents<>i.subtotal_cents+i.gst_cents then raise exception 'INVALID_INVOICE_TOTAL'; end if;
 if exists(select 1 from public.billing_invoice_payment_context where invoice_id=i.id) then
  if not exists(select 1 from public.billing_invoice_payment_context where invoice_id=i.id and customer_id=p_customer) then raise exception 'CUSTOMER_MISMATCH'; end if;
  return;
 end if;
 -- Only an agreement accepted before issue is eligible; preserve its immutable version.
 select p.id as partner_id,a.user_id,ov.id as offer_id,ov.configuration into offer
 from public.m7_company_referrals r join public.m7_partner_accounts p on p.id=r.referring_partner_id
 join private.partner_offer_versions ov on ov.partner_id=p.id
 join private.partner_offer_acceptances a on a.offer_id=ov.id
 where r.organisation_id=i.organisation_id and p.status='active' and p.verification_confirmed
 and a.accepted_at<=i.issued_at and ov.effective_from<=i.issued_at
 order by ov.effective_from desc,a.accepted_at desc limit 1;
 if found and coalesce((offer.configuration->>'commission_enabled')::boolean,false) then
  -- Never infer a commission category from a display description. Require a typed source charge.
  select coalesce(sum(c.cents),0)::integer into base
  from jsonb_array_elements(i.lines) l join public.billing_one_time_charges c on c.id::text=l->>'source_charge_id'
  where c.organisation_id=i.organisation_id and c.month=i.month and c.cents=(l->>'total_cents')::integer
   and c.fee_category in (select jsonb_array_elements_text(offer.configuration->'eligible_fee_categories'))
   and not exists(select 1 from public.m7_partner_commissions old where old.source_charge_id=c.id);
 end if;
 if base>i.subtotal_cents then raise exception 'INVALID_COMMISSION_BASE'; end if;
 update public.billing_invoices set supplier_snapshot=supplier_snapshot||jsonb_build_object('sandbox_test',true),automation_managed=false where id=i.id returning * into i;
 fingerprint:=md5(jsonb_build_array(i.organisation_id,i.cycle_id,i.month,i.issued_at,i.lines,i.subtotal_cents,i.gst_cents,i.total_cents,i.company_snapshot,i.supplier_snapshot)::text);
 insert into public.billing_invoice_payment_context(invoice_id,customer_id,invoice_hash,partner_id,beneficiary_user_id,offer_id,eligible_base_cents,rate_bps,created_by)
 values(i.id,p_customer,fingerprint,offer.partner_id,offer.user_id,offer.offer_id,base,case when base>0 then (offer.configuration->>'rate_bps')::integer else 0 end,p_owner);
 insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata) values(i.organisation_id,p_owner,'sandbox_invoice_registered','billing_invoice',i.id,jsonb_build_object('mode','sandbox'));
end $$;
create or replace function public.billing_reconcile_sandbox_invoice(p_event text,p_invoice uuid,p_intent text,p_customer text,p_amount integer,p_currency text,p_status text,p_live boolean) returns void language plpgsql security invoker set search_path='' as $$
declare i public.billing_invoices%rowtype;c public.billing_invoice_payment_context%rowtype;
begin
 select * into strict i from public.billing_invoices where id=p_invoice for update;
 select * into strict c from public.billing_invoice_payment_context where invoice_id=p_invoice for update;
 if p_live is distinct from false or p_currency is distinct from 'aud' or p_amount is distinct from i.total_cents or p_customer is distinct from c.customer_id or nullif(p_event,'') is null or nullif(p_intent,'') is null then raise exception 'PAYMENT_MISMATCH'; end if;
 if c.intent_id is not null and c.intent_id<>p_intent then raise exception 'INTENT_MISMATCH'; end if;
 if c.invoice_hash<>md5(jsonb_build_array(i.organisation_id,i.cycle_id,i.month,i.issued_at,i.lines,i.subtotal_cents,i.gst_cents,i.total_cents,i.company_snapshot,i.supplier_snapshot)::text) then raise exception 'INVOICE_CHANGED'; end if;
 insert into public.billing_stripe_events(id) values(p_event) on conflict do nothing;
 if not found then return; end if;
 if i.status='paid' then return; end if;
 update public.billing_invoice_payment_context set intent_id=p_intent where invoice_id=i.id;
 update public.billing_invoices set stripe_payment_intent_id=p_intent,payment_status=case p_status when 'succeeded' then 'paid' when 'processing' then 'processing' when 'requires_payment_method' then 'failed' when 'canceled' then 'failed' else 'requires_action' end,
 status=case when p_status='succeeded' then 'paid' else status end,paid_at=case when p_status='succeeded' then now() else paid_at end,payment_reference=case when p_status='succeeded' then 'SANDBOX ONLY: '||p_intent else payment_reference end where id=i.id returning * into i;
 if p_status='succeeded' then
  insert into public.billing_invoice_receipts(invoice_id,receipt_number,mode,snapshot)
  values(i.id,'TEST-R-'||i.invoice_number,'sandbox',jsonb_build_object('invoice',to_jsonb(i),'payment_intent',p_intent,'received_at',now(),'total_cents',p_amount,'currency','AUD','notice','SANDBOX TEST RECEIPT — NO MONEY RECEIVED')) on conflict do nothing;
  insert into public.billing_delivery_jobs(invoice_id,kind,state,error_code) values(i.id,'receipt_email','review','SANDBOX_EMAIL_HELD') on conflict do nothing;
  if c.eligible_base_cents>0 and c.rate_bps>0 then
   insert into public.billing_invoice_commissions(invoice_id,partner_id,beneficiary_user_id,offer_id,eligible_base_cents,rate_bps,commission_cents,mode)
   values(i.id,c.partner_id,c.beneficiary_user_id,c.offer_id,c.eligible_base_cents,c.rate_bps,round(c.eligible_base_cents::numeric*c.rate_bps/10000)::integer,'sandbox') on conflict do nothing;
  end if;
 elsif p_status in ('requires_payment_method','canceled') then
  insert into public.billing_delivery_jobs(invoice_id,kind,state,error_code) values(i.id,'failure_email','review','SANDBOX_EMAIL_HELD') on conflict do nothing;
 end if;
end $$;
revoke all on function public.billing_register_sandbox_invoice(uuid,text,uuid),public.billing_reconcile_sandbox_invoice(text,uuid,text,text,integer,text,text,boolean) from public,anon,authenticated;
grant execute on function public.billing_register_sandbox_invoice(uuid,text,uuid),public.billing_reconcile_sandbox_invoice(text,uuid,text,text,integer,text,text,boolean) to service_role;
commit;
begin;
do $$
declare d text;
begin
 d:=pg_get_functiondef('private.billing_assign(uuid,text,text,date)'::regprocedure);
 if position('fee_category' in d)=0 then
  d:=replace(d,'billing_one_time_charges(organisation_id,source_key,description,cents,month)','billing_one_time_charges(organisation_id,source_key,description,cents,month,fee_category)');
  d:=replace(d,'''Company setup (includes Head Broker)'',cents,m)','''Company setup (includes Head Broker)'',cents,m,''setup'')');
  execute d;
 end if;
 d:=pg_get_functiondef('private.billing_capture_broker()'::regprocedure);
 if position('fee_category' in d)=0 then
  d:=replace(d,'billing_one_time_charges(organisation_id,source_key,description,cents,month)','billing_one_time_charges(organisation_id,source_key,description,cents,month,fee_category)');
  d:=replace(d,'''Additional broker activation'',cents,m)','''Additional broker activation'',cents,m,''broker_activation'')');
  execute d;
 end if;
 d:=pg_get_functiondef('private.billing_invoice_internal(uuid,date)'::regprocedure);
 if position('source_charge_id' in d)=0 then
  d:=replace(d,'''description'',description,''quantity'',1,''unit_cents'',cents,''total_cents'',cents','''description'',description,''quantity'',1,''unit_cents'',cents,''total_cents'',cents,''source_charge_id'',id,''fee_category'',fee_category');
  execute d;
 end if;
end $$;
commit;
