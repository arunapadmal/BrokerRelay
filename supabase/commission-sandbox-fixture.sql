-- Development-only positive commission fixture. Not a real fee or invoice period.
begin;
do $$
declare org uuid;owner_id uuid;cyc uuid;charge uuid;inv uuid;plan_id uuid;
begin
 select o.id into strict org from public.organisations o join public.m7_company_referrals r on r.organisation_id=o.id join public.m7_partner_accounts p on p.id=r.referring_partner_id where o.name='XYZ' and p.display_name='Anjana Weerakkody' and p.status='active';
 if exists(select 1 from public.billing_one_time_charges where source_key='sandbox-commission-fixture-v1:'||org) then return;end if;
 select user_id into owner_id from public.platform_admins limit 1;
 select id into strict plan_id from public.billing_plan_versions where plan_key='basic' order by effective_from desc limit 1;
 insert into public.billing_cycles(organisation_id,month,plan_version_id,plan_name,monthly_cents,included_settlements,extra_cents) values(org,date '2199-01-01',plan_id,'SANDBOX COMMISSION FIXTURE ONLY',0,0,0) returning id into cyc;
 insert into public.billing_one_time_charges(organisation_id,source_key,description,cents,month,fee_category) values(org,'sandbox-commission-fixture-v1:'||org,'SANDBOX setup-fee test — not a real fee',10000,date '2199-01-01','setup') returning id into charge;
 insert into public.billing_invoices(organisation_id,cycle_id,month,company_snapshot,supplier_snapshot,lines,total_cents,subtotal_cents,gst_cents,gst_rate,due_date)
 select org,cyc,date '2199-01-01',jsonb_build_object('name','XYZ — SANDBOX COMMISSION TEST','billing_email',billing_email),jsonb_build_object('name','BrokerRelay SANDBOX — NO MONEY DUE','payment_instructions','TEST FIXTURE ONLY. Never pay. Artificial period 2199 isolates this fixture from normal monthly billing.','sandbox_test',true),jsonb_build_array(jsonb_build_object('description','SANDBOX setup-fee test','quantity',1,'unit_cents',10000,'total_cents',10000,'source_charge_id',charge,'fee_category','setup')),11000,10000,1000,10,current_date from public.organisations where id=org returning id into inv;
 -- These jobs were created only inside this transaction and have never been delivered.
 update public.billing_delivery_jobs set state='review',error_code='SANDBOX_EMAIL_HELD' where invoice_id=inv and kind='invoice_email';
 update public.billing_delivery_jobs set available_at='2199-01-01'::timestamptz where invoice_id=inv and kind='debit';
 update public.billing_invoices set automation_managed=false,payment_status='manual',due_date='2199-01-08',debit_at='2199-01-08 09:00:00+11' where id=inv;
 insert into public.audit_events(organisation_id,actor_user_id,event_type,entity_type,entity_id,metadata) values(org,owner_id,'sandbox_commission_fixture_created','billing_invoice',inv,jsonb_build_object('mode','sandbox','expected_commission_cents',2000));
end $$;
commit;
