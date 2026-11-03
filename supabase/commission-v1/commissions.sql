-- Collected-fee commissions, Development implementation. No bank transfers.
create table private.commission_programs(
 offer_id uuid primary key references private.partner_offer_versions(id),
 partner_id uuid not null references public.m7_partner_accounts(id),
 requested_by uuid not null,requested_at timestamptz not null default now(),
 consent_version text not null default 'collected-fee-tracking-v1',accepted_by uuid,accepted_at timestamptz
);
create table private.commission_entries(
 id uuid primary key default gen_random_uuid(),invoice_id uuid not null references public.billing_invoices(id),
 line_number integer not null,source_charge_id uuid unique,partner_id uuid not null references public.m7_partner_accounts(id),
 offer_id uuid not null references private.partner_offer_versions(id),category text not null check(category in ('setup','subscription','settlement_usage')),
 service_date date not null,base_cents integer not null check(base_cents>0),rate_bps integer not null check(rate_bps between 1 and 10000),
 original_cents integer not null check(original_cents>=0),refund_cents integer not null default 0,
 state text not null default 'pending' check(state in ('pending','approved','paid','reversed')),
 mode text not null default 'sandbox' check(mode='sandbox'),
 approved_by uuid,approved_at timestamptz,paid_cents integer not null default 0,paid_at timestamptz,
 created_at timestamptz not null default now(),unique(invoice_id,line_number),
 check(refund_cents between 0 and original_cents)
);
create table private.commission_payouts(
 id uuid primary key,partner_id uuid not null references public.m7_partner_accounts(id),
 mode text not null check(mode='sandbox'),amount_cents integer not null check(amount_cents>0),
 reference text not null,recorded_by uuid not null,recorded_at timestamptz not null default now(),
 unique(mode,reference)
);
create table private.commission_payout_lines(
 payout_id uuid not null references private.commission_payouts(id),entry_id uuid not null references private.commission_entries(id),
 cents integer not null check(cents>0),primary key(payout_id,entry_id),unique(entry_id)
);
create table private.commission_recoveries(
 entry_id uuid primary key references private.commission_entries(id),settled_cents integer not null default 0 check(settled_cents>=0)
);
-- Private tables have no direct client privileges. Portal access uses checked RPCs.
alter table private.commission_programs enable row level security;
alter table private.commission_entries enable row level security;
alter table private.commission_payouts enable row level security;
alter table private.commission_payout_lines enable row level security;
alter table private.commission_recoveries enable row level security;
revoke all on private.commission_programs,private.commission_entries,private.commission_payouts,private.commission_payout_lines,private.commission_recoveries from public,anon,authenticated;

create function public.commission_request_activation(p_partner uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.m7_partner_accounts;
begin
 perform private.require_partner_owner();select * into strict p from public.m7_partner_accounts where id=p_partner;
 if p.status<>'active' or not p.verification_confirmed or not exists(select 1 from private.partner_offer_acceptances where offer_id=p.current_offer_id) then raise exception 'ACTIVE_ACCEPTED_PARTNER_REQUIRED';end if;
 insert into private.commission_programs(offer_id,partner_id,requested_by) values(p.current_offer_id,p.id,auth.uid()) on conflict do nothing;
 insert into public.audit_events(actor_user_id,event_type,entity_type,entity_id) values(auth.uid(),'commission_activation_requested','partner',p.id);
end $$;
create function public.commission_accept_activation(p_offer uuid) returns void language plpgsql security definer set search_path='' as $$
declare me uuid:=private.partner_portal_identity();
begin
 perform 1 from public.m7_partner_accounts where id=me and status='active' and current_offer_id=p_offer for update;if not found then raise exception 'CURRENT_ACTIVE_OFFER_REQUIRED';end if;
 if not exists(select 1 from private.partner_offer_acceptances where offer_id=p_offer and user_id=auth.uid()) then raise exception 'ACCEPTED_OFFER_REQUIRED';end if;
 update private.commission_programs set accepted_by=auth.uid(),accepted_at=now() where offer_id=p_offer and partner_id=me and accepted_at is null;
 if found then insert into public.audit_events(actor_user_id,event_type,entity_type,entity_id) values(auth.uid(),'commission_activation_accepted','partner',me);end if;
end $$;

-- Freeze per-line entitlements when sandbox payment is registered. The original
-- invoice and its supplier/fee snapshots are never edited by this module.
create function private.commission_freeze(p_invoice uuid) returns void language plpgsql security definer set search_path='' as $$
declare i public.billing_invoices;cy public.billing_cycles;r public.m7_company_referrals;l jsonb;n bigint;cat text;amount integer;beneficiary uuid;service date;ov record;
begin
 select * into strict i from public.billing_invoices where id=p_invoice;
 select * into cy from public.billing_cycles where id=i.cycle_id;
 select * into r from public.m7_company_referrals where organisation_id=i.organisation_id;
 if r.id is null then return;end if;
 for l,n in select value,ordinality from jsonb_array_elements(i.lines) with ordinality loop
  cat:=null;amount:=(l->>'total_cents')::integer;
  if amount<=0 then continue;end if;
  if l ? 'source_charge_id' then
   select fee_category into cat from public.billing_one_time_charges c where c.id::text=l->>'source_charge_id' and c.organisation_id=i.organisation_id and c.month=i.month and c.cents=amount and c.fee_category='setup'
   and not exists(select 1 from public.m7_partner_commissions old where old.source_charge_id=c.id);
  elsif n=1 and amount=cy.monthly_cents and (l->>'quantity')::integer=1 and (l->>'unit_cents')::integer=cy.monthly_cents then cat:='subscription';
  elsif n=2 and (l->>'unit_cents')::integer=cy.extra_cents and amount=(l->>'quantity')::integer*cy.extra_cents and (l->>'quantity')::integer=greatest((select count(*) from public.billing_settlements where cycle_id=cy.id)-cy.included_settlements,0) then cat:='settlement_usage';end if;
  if cat is null then continue;end if;
  service:=case when cat='setup' then (i.issued_at at time zone 'Australia/Melbourne')::date else i.month end;
  beneficiary:=case when cat='setup' then r.referring_partner_id else private.referral_beneficiary(r.id,service) end;
  select v.id,v.configuration into ov from private.partner_offer_versions v
   join private.partner_offer_acceptances a on a.offer_id=v.id
   join public.m7_partner_accounts p on p.id=v.partner_id
   where v.partner_id=beneficiary and p.status='active' and p.verification_confirmed
   and a.accepted_at<=i.issued_at and v.effective_from<=i.issued_at 
   and (cat='setup' or (v.effective_from at time zone 'Australia/Melbourne')::date<=service )
   order by v.effective_from desc,a.accepted_at desc limit 1;
  if not found then continue;end if;
  if not exists(select 1 from private.commission_programs cp join private.partner_offer_acceptances a on a.offer_id=cp.offer_id and a.user_id=cp.accepted_by where cp.offer_id=ov.id and cp.accepted_at<=i.issued_at and (cat='setup' or (cp.accepted_at at time zone 'Australia/Melbourne')::date<=service)) then continue;end if;
  if not coalesce((ov.configuration->>'commission_enabled')::boolean,false) or not (ov.configuration->'eligible_fee_categories' ? cat) or (ov.configuration->>'rate_bps')::integer<=0 then continue;end if;
  insert into private.commission_entries(invoice_id,line_number,source_charge_id,partner_id,offer_id,category,service_date,base_cents,rate_bps,original_cents)
   values(i.id,n,(l->>'source_charge_id')::uuid,beneficiary,ov.id,cat,service,amount,(ov.configuration->>'rate_bps')::integer,round(amount::numeric*(ov.configuration->>'rate_bps')::integer/10000)::integer) on conflict do nothing;
 end loop;
end $$;
create function private.commission_context_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.commission_freeze(new.invoice_id);
 if exists(select 1 from private.commission_entries where invoice_id=new.invoice_id and category='setup') then update public.billing_invoice_payment_context set eligible_base_cents=0,rate_bps=0 where invoice_id=new.invoice_id;end if;
 return new;end $$;
create trigger commission_context_insert after insert on public.billing_invoice_payment_context for each row execute function private.commission_context_insert();
-- The source sandbox receipt is written only after verified payment reconciliation.
create function private.commission_receipt_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.mode='sandbox' then
  insert into public.audit_events(event_type,entity_type,entity_id,metadata) values('commission_payment_confirmed','billing_invoice',new.invoice_id,jsonb_build_object('mode','sandbox'));
 end if;return new;
end $$;
create trigger commission_receipt_insert after insert on public.billing_invoice_receipts for each row execute function private.commission_receipt_insert();
create function private.commission_refund_sync() returns trigger language plpgsql security definer set search_path='' as $$
declare total integer;
begin
 select total_cents into total from public.billing_invoices where id=new.invoice_id;
 update private.commission_entries set refund_cents=case when new.refunded_cents=total then original_cents else round(original_cents::numeric*new.refunded_cents/total)::integer end,
 state=case when state='paid' then 'paid' when new.refunded_cents=total then 'reversed' else 'pending' end,approved_at=case when state='paid' then approved_at else null end,approved_by=case when state='paid' then approved_by else null end where invoice_id=new.invoice_id;
 return new;
end $$;
create trigger commission_refund_sync after insert or update on public.billing_invoice_refunds for each row execute function private.commission_refund_sync();

create function public.commission_review(p_entry uuid,p_approve boolean,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare e private.commission_entries;
begin
 perform private.require_partner_owner();if length(btrim(coalesce(p_note,'')))<5 then raise exception 'REVIEW_NOTE_REQUIRED';end if;
 select * into strict e from private.commission_entries where id=p_entry for update;
 if e.state not in ('pending','approved') or e.original_cents<=e.refund_cents or not exists(select 1 from public.billing_invoice_receipts where invoice_id=e.invoice_id and mode=e.mode) then raise exception 'COLLECTED_ELIGIBLE_COMMISSION_REQUIRED';end if;
 if not exists(select 1 from public.m7_partner_accounts where id=e.partner_id and status='active' and verification_confirmed) then raise exception 'ACTIVE_VERIFIED_PARTNER_REQUIRED';end if;
 update private.commission_entries set state=case when p_approve then 'approved' else 'pending' end,approved_by=case when p_approve then auth.uid() end,approved_at=case when p_approve then now() end where id=e.id;
 insert into public.audit_events(actor_user_id,event_type,entity_type,entity_id,metadata) values(auth.uid(),'commission_review','commission',e.id,jsonb_build_object('approved',p_approve,'note',p_note,'mode',e.mode));
end $$;

create function public.commission_record_payout(p_request uuid,p_partner uuid,p_entries uuid[],p_reference text,p_amount integer) returns uuid language plpgsql security definer set search_path='' as $$
declare total integer;cnt integer;old private.commission_payouts;recovery integer;
begin
 perform private.require_partner_owner();
 perform 1 from public.m7_partner_accounts where id=p_partner and status='active' and verification_confirmed for update;if not found then raise exception 'ACTIVE_VERIFIED_PARTNER_REQUIRED';end if;
 select * into old from private.commission_payouts where id=p_request;
 if found then if old.partner_id<>p_partner or old.reference<>btrim(p_reference) or old.amount_cents<>p_amount or (select array_agg(entry_id order by entry_id) from private.commission_payout_lines where payout_id=old.id) is distinct from (select array_agg(x order by x) from unnest(p_entries) x) then raise exception 'PAYOUT_REQUEST_CONFLICT';end if;return old.id;end if;
 if length(btrim(coalesce(p_reference,''))) not between 5 and 160 or p_amount<=0 or coalesce(cardinality(p_entries),0)=0 then raise exception 'PAYOUT_DETAILS_REQUIRED';end if;
 perform 1 from private.commission_entries where partner_id=p_partner order by id for update;
 select coalesce(sum(greatest(e.paid_cents-(e.original_cents-e.refund_cents)-coalesce(r.settled_cents,0),0)),0)::integer into recovery from private.commission_entries e left join private.commission_recoveries r on r.entry_id=e.id where e.partner_id=p_partner and e.state='paid';
 if recovery>0 then raise exception 'REFUND_RECOVERY_REVIEW_REQUIRED: % cents outstanding',recovery;end if;
 select sum(e.original_cents-e.refund_cents),count(*) into total,cnt from private.commission_entries e where id=any(p_entries) and partner_id=p_partner and state='approved'
 and exists(select 1 from public.billing_invoice_receipts where invoice_id=e.invoice_id and mode='sandbox');
 if cnt<>(select count(distinct x) from unnest(p_entries) x) or cnt<>cardinality(p_entries) or total is distinct from p_amount then raise exception 'PAYOUT_AMOUNT_OR_SELECTION_CHANGED';end if;
 insert into private.commission_payouts(id,partner_id,mode,amount_cents,reference,recorded_by) values(p_request,p_partner,'sandbox',total,btrim(p_reference),auth.uid());
 insert into private.commission_payout_lines(payout_id,entry_id,cents) select p_request,id,original_cents-refund_cents from private.commission_entries where id=any(p_entries);
 update private.commission_entries set state='paid',paid_at=now(),paid_cents=original_cents-refund_cents where id=any(p_entries);
 insert into public.audit_events(actor_user_id,event_type,entity_type,entity_id,metadata) values(auth.uid(),'commission_payout_recorded','commission_payout',p_request,jsonb_build_object('amount_cents',total,'reference',p_reference,'mode','sandbox','no_money_sent',true));return p_request;
end $$;
create function public.commission_record_recovery(p_entry uuid,p_amount integer,p_reference text) returns void language plpgsql security definer set search_path='' as $$
declare e private.commission_entries;settled integer;
begin
 perform private.require_partner_owner();select * into strict e from private.commission_entries where id=p_entry for update;
 select coalesce(settled_cents,0) into settled from private.commission_recoveries where entry_id=e.id;settled:=coalesce(settled,0);
 if e.state<>'paid' or p_amount<=0 or p_amount>e.paid_cents-(e.original_cents-e.refund_cents)-settled or length(btrim(coalesce(p_reference,'')))<5 then raise exception 'VALID_RECOVERY_REQUIRED';end if;
 insert into private.commission_recoveries(entry_id,settled_cents) values(e.id,p_amount) on conflict(entry_id) do update set settled_cents=private.commission_recoveries.settled_cents+excluded.settled_cents;
 insert into public.audit_events(actor_user_id,event_type,entity_type,entity_id,metadata) values(auth.uid(),'commission_recovery_recorded','commission',e.id,jsonb_build_object('cents',p_amount,'reference',p_reference,'mode','sandbox'));
end $$;

create function public.commission_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid;owner boolean:=private.is_platform_admin();
begin
 if auth.uid() is null then raise exception 'LOGIN_REQUIRED';end if;
 if not owner then me:=private.partner_portal_identity();end if;
 return jsonb_build_object('owner',owner,'mode','sandbox','partners',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'offer_id',p.current_offer_id,'categories',v.configuration->'eligible_fee_categories','rate_bps',v.configuration->'rate_bps','requested',cp.requested_at,'accepted',cp.accepted_at)) from public.m7_partner_accounts p left join private.partner_offer_versions v on v.id=p.current_offer_id left join private.commission_programs cp on cp.offer_id=v.id where owner or p.id=me),'[]'),
 'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'invoice',i.invoice_number,'company',i.company_snapshot->>'name','partner_id',e.partner_id,'partner',p.display_name,'category',e.category,'service_date',e.service_date,'base_cents',e.base_cents,'rate_bps',e.rate_bps,'original_cents',e.original_cents,'refund_cents',e.refund_cents,'net_cents',e.original_cents-e.refund_cents,'state',case when not exists(select 1 from public.billing_invoice_receipts where invoice_id=e.invoice_id) then 'awaiting_payment' else e.state end,'paid_cents',e.paid_cents,'recovery_cents',greatest(e.paid_cents-(e.original_cents-e.refund_cents)-coalesce(r.settled_cents,0),0),'created_at',e.created_at) order by e.created_at desc) from private.commission_entries e join public.billing_invoices i on i.id=e.invoice_id join public.m7_partner_accounts p on p.id=e.partner_id left join private.commission_recoveries r on r.entry_id=e.id where owner or e.partner_id=me),'[]'),
 'payouts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'partner_id',partner_id,'amount_cents',amount_cents,'reference',reference,'recorded_at',recorded_at) order by recorded_at desc) from private.commission_payouts where owner or partner_id=me),'[]'));
end $$;
-- Only the checked portal functions are callable by signed-in users.
revoke all on function private.commission_freeze(uuid),private.commission_context_insert(),private.commission_receipt_insert(),private.commission_refund_sync() from public,anon,authenticated;
revoke all on function public.commission_request_activation(uuid),public.commission_accept_activation(uuid),public.commission_review(uuid,boolean,text),public.commission_record_payout(uuid,uuid,uuid[],text,integer),public.commission_record_recovery(uuid,integer,text),public.commission_workspace() from public,anon;
grant execute on function public.commission_request_activation(uuid),public.commission_accept_activation(uuid),public.commission_review(uuid,boolean,text),public.commission_record_payout(uuid,uuid,uuid[],text,integer),public.commission_record_recovery(uuid,integer,text),public.commission_workspace() to authenticated;
