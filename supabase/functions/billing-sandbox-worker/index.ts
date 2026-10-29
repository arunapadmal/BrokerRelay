import {adminClient,checked,json,required,stripe} from '../_shared/billing.ts'
import {assertSandboxEnvironment} from '../_shared/sandbox.ts'
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405)
 if(!Deno.env.get('BILLING_WORKER_TOKEN')||req.headers.get('x-billing-token')!==Deno.env.get('BILLING_WORKER_TOKEN'))return json({error:'WORKER_AUTH_REQUIRED'},401)
 try{
  assertSandboxEnvironment(n=>Deno.env.get(n));const db=adminClient();const rows=await checked(db.from('billing_invoice_payment_context').select('invoice_id').eq('scheduled',true).is('intent_id',null).order('created_at').limit(50));let submitted=0,waiting=0,review=0
  for(const r of rows){const token=crypto.randomUUID();try{
   const c=await checked(db.rpc('billing_claim_sandbox_collection',{p_invoice:r.invoice_id,p_token:token}));if(!c){waiting++;continue}
   const i=c.invoice,a=c.account
   const pi=await stripe('payment_intents',{amount:String(i.total_cents),currency:'aud',customer:a.stripe_customer_id,payment_method:a.stripe_payment_method_id,mandate:a.stripe_mandate_id,'payment_method_types[0]':'au_becs_debit',off_session:'true',confirm:'true','metadata[brokerrelay_invoice_id]':i.id,'metadata[brokerrelay_invoice_test]':'true'},`br-sandbox-scheduled-${i.id}`)
   if(pi.livemode!==false)throw new Error('TEST_PAYMENT_REQUIRED')
   await checked(db.from('billing_invoice_payment_context').update({intent_id:pi.id,collection_token:null,collection_lease_until:null}).eq('invoice_id',i.id).eq('collection_token',token));submitted++
  }catch(e){review++;await checked(db.from('billing_invoices').update({delivery_error:'SANDBOX_COLLECTION_REVIEW_REQUIRED'}).eq('id',r.invoice_id));await checked(db.from('billing_invoice_payment_context').update({collection_token:null,collection_lease_until:null}).eq('invoice_id',r.invoice_id).eq('collection_token',token));console.error('Sandbox collection:',e instanceof Error?e.message:'ERROR')}}
  return json({submitted,waiting,review,mode:'sandbox'})
 }catch{return json({error:'SANDBOX_WORKER_FAILED'},500)}
})
