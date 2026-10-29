import { adminClient, checked, json, required, stripe, verifyStripeSignature } from '../_shared/billing.ts'
import { assertSandboxEnvironment } from '../_shared/sandbox.ts'
import { reconcileRefund } from '../_shared/refunds.ts'
Deno.serve(async (req: Request) => {
 if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405)
 try {
  assertSandboxEnvironment(name => Deno.env.get(name))
  const raw=await req.text(); if(!(await verifyStripeSignature(raw,req.headers.get('stripe-signature')??'',required('STRIPE_WEBHOOK_SECRET')))) return json({error:'BAD_SIGNATURE'},400)
  const event=JSON.parse(raw); const db=adminClient(); const obj=event.data.object
  if(event.livemode !== false) return json({error:'TEST_EVENT_REQUIRED'},400)
  if(event.type==='setup_intent.succeeded') {
   const si=await stripe(`setup_intents/${encodeURIComponent(obj.id)}`); if(si.livemode !== false) throw new Error('TEST_SETUP_REQUIRED'); if(si.status!=='succeeded') return json({received:true})
   const account=await checked(db.from('billing_payment_accounts').select('*').eq('organisation_id',si.metadata.organisation_id).maybeSingle())
   if(account && account.stripe_customer_id===si.customer && account.setup_intent_id===si.id && account.livemode===si.livemode) {
    const pm=await stripe(`payment_methods/${encodeURIComponent(si.payment_method)}`)
    if(!si.mandate || pm.type!=='au_becs_debit' || pm.customer!==account.stripe_customer_id)throw new Error('MANDATE_NOT_READY')
    await checked(db.from('billing_payment_accounts').update({stripe_payment_method_id:pm.id,stripe_mandate_id:si.mandate,last4:pm.au_becs_debit?.last4,ready:true,enabled:true,updated_at:new Date().toISOString()}).eq('organisation_id',account.organisation_id).eq('setup_intent_id',si.id))
   }
  } else if(event.type.startsWith('payment_intent.')) {
   const pi=await stripe(`payment_intents/${encodeURIComponent(obj.id)}`)
   if(pi.metadata?.brokerrelay_invoice_test==='true') {
    await checked(db.rpc('billing_reconcile_sandbox_invoice',{p_event:event.id,p_invoice:pi.metadata.brokerrelay_invoice_id,p_intent:pi.id,p_customer:pi.customer,p_amount:pi.amount,p_currency:pi.currency,p_status:pi.status,p_live:pi.livemode}))
    return json({received:true})
   }
   const id=pi.metadata?.brokerrelay_sandbox_run
   if(!id)return json({received:true,ignored:'NOT_A_SANDBOX_INVOICE_TEST'})
   const run=await checked(db.from('billing_sandbox_runs').select('*').eq('id',id).maybeSingle())
   if(!run || pi.livemode!==false || pi.currency!==run.currency || pi.amount!==run.amount_cents || pi.customer!==run.customer_id || (run.intent_id && run.intent_id!==pi.id))throw new Error('SANDBOX_PAYMENT_MISMATCH')
   const status=pi.status==='succeeded'?'paid':pi.status==='processing'?'processing':['requires_payment_method','canceled'].includes(pi.status)?'failed':'requires_action'
   // Terminal states cannot regress; duplicate deliveries cannot create another payment.
   await checked(db.from('billing_sandbox_runs').update({intent_id:pi.id,status,last_event_id:event.id,webhook_received_at:new Date().toISOString()}).eq('id',id).not('status','in','(paid,failed)'))
  } else if(event.type==='charge.refunded') {
   await reconcileRefund(db,obj.id,event.id)
  } else if(['refund.created','refund.updated','refund.failed'].includes(event.type)) {
   const refund=await stripe(`refunds/${encodeURIComponent(obj.id)}`)
   if(refund.charge)await reconcileRefund(db,typeof refund.charge==='string'?refund.charge:refund.charge.id,event.id)
  } else if(event.type==='mandate.updated' && obj.status==='inactive') {
   await checked(db.from('billing_payment_accounts').update({ready:false,enabled:false}).eq('stripe_mandate_id',obj.id))
  } else if(event.type==='payment_method.detached') {
   await checked(db.from('billing_payment_accounts').update({ready:false,enabled:false}).eq('stripe_payment_method_id',obj.id))
  }
  return json({received:true})
 } catch(e) { console.error('Billing webhook:',e instanceof Error?e.message:'ERROR'); return json({error:'WEBHOOK_PROCESSING_FAILED'},500) }
})
