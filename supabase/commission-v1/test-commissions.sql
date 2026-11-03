-- Execute inside a transaction after commissions.sql; always roll back.
do $$
declare own uuid;pid uuid;uid uuid;ov uuid;oldov private.partner_offer_versions;org uuid;cy uuid;inv uuid;plan uuid;e uuid;pay uuid:=gen_random_uuid();result jsonb;receiver uuid;ref uuid;
begin
 select user_id into strict own from public.platform_admins limit 1;
 perform set_config('request.jwt.claim.sub',own::text,true);
 select p.id,r.organisation_id,a.user_id into strict pid,org,uid from public.m7_partner_accounts p join public.m7_company_referrals r on r.referring_partner_id=p.id join private.partner_offer_acceptances a on a.offer_id=p.current_offer_id where p.display_name='Anjana Weerakkody' limit 1;
 select * into oldov from private.partner_offer_versions where partner_id=pid order by effective_from desc limit 1;
 ov:=gen_random_uuid();
 insert into private.partner_offer_versions(id,partner_id,created_by,effective_from,configuration,terms_version,terms_sha256,privacy_version,privacy_sha256)
 values(ov,pid,own,now()-interval '1 hour',oldov.configuration||jsonb_build_object('eligible_fee_categories',jsonb_build_array('subscription','settlement_usage'),'rate_bps',2000),oldov.terms_version,oldov.terms_sha256,oldov.privacy_version,oldov.privacy_sha256);
 insert into private.partner_offer_acceptances(offer_id,partner_id,user_id,email,accepted_at,offer_snapshot) values(ov,pid,uid,'rollback-test@example.com',now()-interval '30 minutes','{}');
 insert into private.commission_programs(offer_id,partner_id,requested_by,accepted_by,accepted_at) values(ov,pid,own,uid,now()-interval '10 minutes');
 select id into plan from public.billing_plan_versions limit 1;
 insert into public.billing_cycles(organisation_id,month,plan_version_id,plan_name,monthly_cents,included_settlements,extra_cents) values(org,'2200-01-01',plan,'ROLLBACK TEST',10000,0,1000) returning id into cy;
 update public.billing_settlements set cycle_id=cy,organisation_id=org where application_id=(select application_id from public.billing_settlements limit 1);
 insert into public.billing_invoices(organisation_id,cycle_id,month,company_snapshot,supplier_snapshot,lines,total_cents,subtotal_cents,gst_cents,gst_rate,due_date)
 values(org,cy,'2200-01-01','{"name":"ROLLBACK TEST"}','{"name":"ROLLBACK TEST","sandbox_test":true}',jsonb_build_array(jsonb_build_object('description','Typed cycle subscription','quantity',1,'unit_cents',10000,'total_cents',10000),jsonb_build_object('description','Unused overage','quantity',1,'unit_cents',1000,'total_cents',1000)),12100,11000,1100,10,current_date) returning id into inv;
 perform public.billing_register_sandbox_invoice(inv,'cus_rollback',own);
 select id into strict e from private.commission_entries where invoice_id=inv and category='subscription';
 if not exists(select 1 from private.commission_entries where invoice_id=inv and category='settlement_usage' and original_cents=200) then raise exception 'Settlement usage calculation failed';end if;
 if (select original_cents from private.commission_entries where id=e)<>2000 then raise exception 'Subscription amount failed';end if;
 begin perform public.commission_review(e,true,'Cannot approve unpaid');raise exception 'Unpaid approval allowed';exception when others then if sqlerrm<>'COLLECTED_ELIGIBLE_COMMISSION_REQUIRED' then raise;end if;end;
 perform public.billing_reconcile_sandbox_invoice('evt_commission_test',inv,'pi_rollback','cus_rollback',12100,'aud','succeeded',false);
 perform public.billing_reconcile_sandbox_invoice('evt_commission_test',inv,'pi_rollback','cus_rollback',12100,'aud','succeeded',false);
 if (select count(*) from private.commission_entries where invoice_id=inv)<>2 then raise exception 'Duplicate commission';end if;
 perform public.commission_review(e,true,'Verified collected subscription');
 perform public.billing_reconcile_sandbox_refund('evt_refund_half',inv,'pi_rollback','ch_rollback','cus_rollback',12100,6050,'aud',false);
 if (select refund_cents<>1000 or state<>'pending' from private.commission_entries where id=e) then raise exception 'Refund must deduct and invalidate approval';end if;
 perform public.commission_review(e,true,'Reviewed partial refund');
 perform public.commission_record_payout(pay,pid,array[e],'TEST-ROLLBACK-1',1000);
 perform public.commission_record_payout(pay,pid,array[e],'TEST-ROLLBACK-1',1000);
 if (select count(*) from private.commission_payouts where id=pay)<>1 then raise exception 'Duplicate payout';end if;
 perform public.billing_reconcile_sandbox_refund('evt_refund_full',inv,'pi_rollback','ch_rollback','cus_rollback',12100,12100,'aud',false);
 if (select paid_cents-(original_cents-refund_cents) from private.commission_entries where id=e)<>1000 then raise exception 'Paid refund recovery missing';end if;
 perform public.commission_record_recovery(e,1000,'TEST-RECOVERY-1');
 if (select settled_cents from private.commission_recoveries where entry_id=e)<>1000 then raise exception 'Recovery reconciliation failed';end if;
 select id into receiver from public.m7_partner_accounts where id<>pid limit 1;
 select id into ref from public.m7_company_referrals where organisation_id=org;
 insert into private.partner_transfers(referral_id,original_partner_id,from_manager_id,from_beneficiary_id,to_partner_id,receiver_offer_id,receiver_offer,effective_from,reason,status,created_by)
 values(ref,pid,pid,pid,receiver,ov,'{}','2200-02-01','Rollback future transfer','approved',own);
 if private.referral_beneficiary(ref,'2200-01-01')<>pid or private.referral_beneficiary(ref,'2200-02-01')<>receiver then raise exception 'Transfer effective date failed';end if;
 if exists(select 1 from private.commission_entries where invoice_id=inv and partner_id<>pid) then raise exception 'Transfer changed prior beneficiary';end if;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 result:=public.commission_workspace();
 if (select count(*) from jsonb_array_elements(result->'entries') x where x->>'partner_id'<>pid::text)>0 then raise exception 'Partner isolation failed';end if;
 begin perform public.commission_review(e,true,'Partner cannot approve');raise exception 'Partner approval allowed';exception when others then if sqlerrm<>'PLATFORM_OWNER_REQUIRED' then raise;end if;end;
end $$;
