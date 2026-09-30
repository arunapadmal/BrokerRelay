import { adminClient, checked, json, required, stripe, verifyStripeSignature } from '../_shared/billing.ts'
Deno.serve(async (req: Request) => {
 if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405)
 try {
  const raw=await req.text(); if(!(await verifyStripeSignature(raw,req.headers.get('stripe-signature')??'',required('STRIPE_WEBHOOK_SECRET')))) return json({error:'BAD_SIGNATURE'},400)
  const event=JSON.parse(raw); const db=adminClient(); const obj=event.data.object
  if(event.type==='setup_intent.succeeded') {
   const si=await stripe(`setup_intents/${encodeURIComponent(obj.id)}`); if(si.status!=='succeeded') return json({received:true})
   const account=await checked(db.from('billing_payment_accounts').select('*').eq('organisation_id',si.metadata.organisation_id).maybeSingle())
   if(account && account.stripe_customer_id===si.customer && account.setup_intent_id===si.id && account.livemode===si.livemode) {
    const pm=await stripe(`payment_methods/${encodeURIComponent(si.payment_method)}`)
    if(!si.mandate || pm.type!=='au_becs_debit' || pm.customer!==account.stripe_customer_id)throw new Error('MANDATE_NOT_READY')
    await checked(db.from('billing_payment_accounts').update({stripe_payment_method_id:pm.id,stripe_mandate_id:si.mandate,last4:pm.au_becs_debit?.last4,ready:true,enabled:true,updated_at:new Date().toISOString()}).eq('organisation_id',account.organisation_id).eq('setup_intent_id',si.id))
   }
  } else if(event.type.startsWith('payment_intent.')) {
   const pi=await stripe(`payment_intents/${encodeURIComponent(obj.id)}`)
   // Sandbox payments must never mark a production invoice as paid.
   if(pi.metadata?.brokerrelay_invoice_id && pi.livemode && pi.currency==='aud') await checked(db.rpc('billing_apply_payment',{p_event:event.id,p_invoice:pi.metadata.brokerrelay_invoice_id,p_intent:pi.id,p_customer:pi.customer,p_amount:pi.amount,p_status:pi.status,p_live:pi.livemode}))
  } else if(event.type==='mandate.updated' && obj.status==='inactive') {
   await checked(db.from('billing_payment_accounts').update({ready:false,enabled:false}).eq('stripe_mandate_id',obj.id))
  } else if(event.type==='payment_method.detached') {
   await checked(db.from('billing_payment_accounts').update({ready:false,enabled:false}).eq('stripe_payment_method_id',obj.id))
  }
  return json({received:true})
 } catch(e) { console.error('Billing webhook:',e instanceof Error?e.message:'ERROR'); return json({error:'WEBHOOK_PROCESSING_FAILED'},500) }
})
