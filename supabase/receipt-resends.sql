-- Development sandbox only. Original receipt delivery is unchanged.
create table if not exists public.billing_sandbox_receipt_resends (
 id uuid primary key, invoice_id uuid not null references public.billing_invoices(id),
 owner_id uuid not null references auth.users(id), recipient text not null,
 payload jsonb not null, created_at timestamptz not null default now(),
 state text not null default 'pending' check(state in ('pending','accepted','rejected')),
 provider_id text, accepted_at timestamptz, error_code text
);
alter table public.billing_sandbox_receipt_resends enable row level security;
revoke all on public.billing_sandbox_receipt_resends from anon,authenticated;
grant select on public.billing_sandbox_receipt_resends to authenticated;
grant all on public.billing_sandbox_receipt_resends to service_role;
create policy owner_read on public.billing_sandbox_receipt_resends for select to authenticated
 using(exists(select 1 from public.platform_admins a where a.user_id=auth.uid()));
create or replace function public.billing_claim_receipt_resend(p_invoice uuid,p_owner uuid,p_request uuid,p_recipient text,p_payload jsonb)
returns public.billing_sandbox_receipt_resends language plpgsql security invoker set search_path=public as $$
declare r public.billing_sandbox_receipt_resends;
begin
 perform 1 from public.billing_invoices where id=p_invoice for update;
 if not exists(select 1 from public.platform_admins where user_id=p_owner) or
 not exists(select 1 from public.billing_invoice_payment_context where invoice_id=p_invoice and mode='sandbox') or
 not exists(select 1 from public.billing_invoice_receipts where invoice_id=p_invoice) or
 not exists(select 1 from public.billing_delivery_jobs j join public.billing_sandbox_email_deliveries d on d.job_id=j.id where j.invoice_id=p_invoice and j.kind='receipt_email')
 then raise exception 'ORIGINAL_TEST_RECEIPT_SEND_REQUIRED';end if;
 select * into r from public.billing_sandbox_receipt_resends where id=p_request;
 if found then
 if r.invoice_id<>p_invoice or r.owner_id<>p_owner or r.recipient<>p_recipient then raise exception 'RESEND_REQUEST_CONFLICT';end if;
 return r;end if;
 select * into r from public.billing_sandbox_receipt_resends where invoice_id=p_invoice and state='pending' order by created_at limit 1;
 if found then
 if r.owner_id<>p_owner or r.recipient<>p_recipient then raise exception 'RESEND_REVIEW_REQUIRED';end if;
 return r;end if;
 if exists(select 1 from public.billing_sandbox_receipt_resends where invoice_id=p_invoice and created_at>now()-interval '60 seconds') then raise exception 'WAIT_ONE_MINUTE_BEFORE_RESENDING';end if;
 if (select count(*) from public.billing_sandbox_receipt_resends where invoice_id=p_invoice and created_at>now()-interval '24 hours')>=10 then raise exception 'DAILY_RESEND_LIMIT_REACHED';end if;
 insert into public.billing_sandbox_receipt_resends(id,invoice_id,owner_id,recipient,payload) values(p_request,p_invoice,p_owner,p_recipient,p_payload) returning * into r;
 return r;
end $$;
revoke all on function public.billing_claim_receipt_resend(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.billing_claim_receipt_resend(uuid,uuid,uuid,text,jsonb) to service_role;
