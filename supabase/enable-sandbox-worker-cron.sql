-- Run only after configuring the SAME random token in Edge Function secret
-- BILLING_WORKER_TOKEN and Vault secret brokerrelay_sandbox_worker_token.
-- No real Stripe collection is possible: the deployed worker requires test keys.
do $$
begin
 if not exists(select 1 from vault.secrets where name='brokerrelay_sandbox_worker_token') then raise exception 'Create Vault secret brokerrelay_sandbox_worker_token first';end if;
 perform cron.schedule('brokerrelay-billing-sandbox-worker','*/15 * * * *',$job$
  select net.http_post(
   url:='https://yhlaynvgmvfxvwhvlboq.supabase.co/functions/v1/billing-sandbox-worker',
   headers:=jsonb_build_object('Content-Type','application/json','x-billing-token',(select decrypted_secret from vault.decrypted_secrets where name='brokerrelay_sandbox_worker_token')),
   body:='{}'::jsonb
  );
 $job$);
end $$;
