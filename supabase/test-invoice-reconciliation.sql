begin;
do $$
declare inv uuid; org uuid; owner_id uuid; partner uuid; charge uuid; referral uuid; other uuid; seed public.billing_invoices%rowtype; cyc uuid; direct_org uuid;
begin
 select user_id into owner_id from public.platform_admins limit 1;
 select id into partner from public.m7_partner_accounts where display_name='Anjana Weerakkody';
 select * into seed from public.billing_invoices order by invoice_number limit 1;
 select organisation_id into org from public.m7_company_referrals where referring_partner_id=partner limit 1;
 select id into direct_org from public.organisations where name='Aidez';
 for n in 1..2 loop
  insert into public.billing_cycles(organisation_id,month,plan_version_id,plan_name,monthly_cents,included_settlements,extra_cents)
  select case when n=1 then org else direct_org end,date '2199-01-01',plan_version_id,plan_name,monthly_cents,included_settlements,extra_cents from public.billing_cycles where id=seed.cycle_id returning id into cyc;
  insert into public.billing_invoices(invoice_number,organisation_id,cycle_id,month,company_snapshot,supplier_snapshot,lines,total_cents,subtotal_cents,gst_cents,gst_rate,due_date) overriding system value
  values(-987654-n,case when n=1 then org else direct_org end,cyc,date '2199-01-01',seed.company_snapshot,seed.supplier_snapshot,seed.lines,seed.total_cents,seed.subtotal_cents,seed.gst_cents,seed.gst_rate,current_date)
  returning id into other;
  if n=1 then inv:=other;end if;
 end loop;
 insert into public.billing_one_time_charges(organisation_id,source_key,description,cents,month,fee_category) select org,'integration-test-'||inv,'Test setup',10000,month,'setup' from public.billing_invoices where id=inv returning id into charge;
 update public.billing_invoices set issued_at=now(),lines=jsonb_build_array(jsonb_build_object('description','Test setup','total_cents',10000,'source_charge_id',charge),jsonb_build_object('description','Monthly subscription','total_cents',2500)),subtotal_cents=12500,gst_cents=1250,total_cents=13750 where id=inv;
 perform public.billing_register_sandbox_invoice(inv,'cus_integration_fixture',owner_id);
 if (select eligible_base_cents from public.billing_invoice_payment_context where invoice_id=inv)<>10000 then raise exception 'ELIGIBLE_SETUP_BASE_WRONG'; end if;
 begin perform public.billing_reconcile_sandbox_invoice('evt_bad',inv,'pi_fixture','cus_integration_fixture',13750,'aud','succeeded',true);raise exception 'LIVE_WAS_ACCEPTED';exception when others then if sqlerrm<>'PAYMENT_MISMATCH' then raise;end if;end;
 begin perform public.billing_reconcile_sandbox_invoice('evt_bad',inv,'pi_fixture','cus_integration_fixture',13751,'aud','succeeded',false);raise exception 'AMOUNT_WAS_ACCEPTED';exception when others then if sqlerrm<>'PAYMENT_MISMATCH' then raise;end if;end;
 perform public.billing_reconcile_sandbox_invoice('evt_fixture_failed',inv,'pi_fixture','cus_integration_fixture',13750,'aud','requires_payment_method',false);
 if exists(select 1 from public.billing_invoice_receipts where invoice_id=inv) or exists(select 1 from public.billing_invoice_commissions where invoice_id=inv) then raise exception 'FAILURE_CREATED_FINANCIAL_RESULT';end if;
 perform public.billing_reconcile_sandbox_invoice('evt_fixture_paid',inv,'pi_fixture','cus_integration_fixture',13750,'aud','succeeded',false);
 perform public.billing_reconcile_sandbox_invoice('evt_fixture_paid',inv,'pi_fixture','cus_integration_fixture',13750,'aud','succeeded',false);
 perform public.billing_reconcile_sandbox_invoice('evt_fixture_late',inv,'pi_fixture','cus_integration_fixture',13750,'aud','processing',false);
 if (select status from public.billing_invoices where id=inv)<>'paid' then raise exception 'PAID_REGRESSED';end if;
 if (select count(*) from public.billing_invoice_receipts where invoice_id=inv)<>1 then raise exception 'RECEIPT_DUPLICATION';end if;
 if (select commission_cents from public.billing_invoice_commissions where invoice_id=inv)<>2000 then raise exception 'COMMISSION_OR_GST_WRONG';end if;
 if (select count(*) from public.billing_delivery_jobs where invoice_id=inv and kind='receipt_email' and state='review' and error_code='SANDBOX_EMAIL_HELD')<>1 then raise exception 'RECEIPT_HOLD_MISSING';end if;
 perform public.billing_register_sandbox_invoice(other,'cus_direct_fixture',owner_id);
 perform public.billing_reconcile_sandbox_invoice('evt_direct_paid',other,'pi_direct_fixture','cus_direct_fixture',(select total_cents from public.billing_invoices where id=other),'aud','succeeded',false);
 if exists(select 1 from public.billing_invoice_commissions where invoice_id=other) then raise exception 'DIRECT_COMPANY_COMMISSION';end if;
end $$;
rollback;
