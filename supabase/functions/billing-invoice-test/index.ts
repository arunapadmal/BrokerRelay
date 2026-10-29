import {adminClient,checked,cors,json,stripe} from '../_shared/billing.ts'
import {assertSandboxEnvironment} from '../_shared/sandbox.ts'
Deno.serve(async(req:Request)=>{
 const headers=cors(req);if(req.method==='OPTIONS')return new Response(null,{headers});if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405,headers)
 try{
  assertSandboxEnvironment(n=>Deno.env.get(n));const db=adminClient(),auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return json({error:'UNAUTHENTICATED'},401,headers)
  const {data:{user},error}=await db.auth.getUser(auth.slice(7));if(error||!user)return json({error:'UNAUTHENTICATED'},401,headers)
  if(!await checked(db.from('platform_admins').select('user_id').eq('user_id',user.id).maybeSingle()))return json({error:'OWNER_REQUIRED'},403,headers)
  const body=await req.json();if(body.sandbox_ack!==true||!['success','failure'].includes(body.scenario)||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(body.invoice_id??''))throw new Error('SANDBOX_INVOICE_CONFIRMATION_REQUIRED')
  const i=await checked(db.from('billing_invoices').select('*').eq('id',body.invoice_id).single());if(i.status!=='issued'||i.total_cents<=0||i.total_cents>1000000)throw new Error('UNPAID_INVOICE_WITHIN_TEST_LIMIT_REQUIRED')
  const existing=await checked(db.from('billing_invoice_payment_context').select('*').eq('invoice_id',i.id).maybeSingle())
  if(existing?.intent_id)throw new Error('TEST_ALREADY_SUBMITTED_REFRESH_INVOICE')
  if(existing && Date.now()-new Date(existing.created_at).getTime()>20*3600000)throw new Error('PAYMENT_RECONCILIATION_REVIEW_REQUIRED')
  const c=existing?{id:existing.customer_id}:await stripe('customers',{name:'BrokerRelay sandbox invoice test','metadata[brokerrelay_invoice_id]':i.id},`br-invoice-test-customer-${i.id}`)
  await checked(db.rpc('billing_register_sandbox_invoice',{p_invoice:i.id,p_customer:c.id,p_owner:user.id}))
  const fields:Record<string,string>={amount:String(i.total_cents),currency:'aud',customer:c.id,confirm:'true',off_session:'true','payment_method_types[0]':'au_becs_debit','payment_method_data[type]':'au_becs_debit','payment_method_data[au_becs_debit][bsb_number]':'000000','payment_method_data[au_becs_debit][account_number]':body.scenario==='success'?'000123456':'222222227','payment_method_data[billing_details][name]':'BrokerRelay Test','payment_method_data[billing_details][email]':'billing-test@example.com','mandate_data[customer_acceptance][type]':'offline','metadata[brokerrelay_invoice_id]':i.id,'metadata[brokerrelay_invoice_test]':'true'}
  const pi=await stripe('payment_intents',fields,`br-invoice-test-${i.id}`);if(pi.livemode!==false)throw new Error('TEST_PAYMENT_REQUIRED')
  await checked(db.from('billing_invoice_payment_context').update({intent_id:pi.id}).eq('invoice_id',i.id).is('intent_id',null))
  return json({submitted:true,reference:pi.id,message:'Awaiting verified webhook. No real money collected.'},200,headers)
 }catch(e){return json({error:e instanceof Error?e.message:'INVOICE_TEST_FAILED'},400,headers)}
})
