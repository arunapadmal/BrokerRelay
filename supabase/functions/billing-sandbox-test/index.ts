import {adminClient,checked,cors,json,required,stripe} from '../_shared/billing.ts'
import {assertSandboxEnvironment} from '../_shared/sandbox.ts'
Deno.serve(async(req:Request)=>{
 const headers=cors(req);if(req.method==='OPTIONS')return new Response(null,{headers});if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405,headers)
 try{
  assertSandboxEnvironment(n=>Deno.env.get(n));const db=adminClient(),auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return json({error:'UNAUTHENTICATED'},401,headers)
  const {data:{user},error}=await db.auth.getUser(auth.slice(7));if(error||!user)return json({error:'UNAUTHENTICATED'},401,headers)
  if(!await checked(db.from('platform_admins').select('user_id').eq('user_id',user.id).maybeSingle()))return json({error:'OWNER_REQUIRED'},403,headers)
  const body=await req.json();if(!/^[0-9a-f-]{36}$/i.test(body.id??''))throw new Error('VALID_TEST_ID_REQUIRED')
  let run=await checked(db.from('billing_sandbox_runs').select('*').eq('id',body.id).maybeSingle())
  if(body.action==='start'){
   if(!['success','failure'].includes(body.scenario))throw new Error('INVALID_SCENARIO')
   if(!run){await checked(db.from('billing_sandbox_runs').insert({id:body.id,created_by:user.id,scenario:body.scenario}));run=await checked(db.from('billing_sandbox_runs').select('*').eq('id',body.id).single())}
   if(run.created_by!==user.id||run.scenario!==body.scenario)throw new Error('TEST_ID_CONFLICT')
   if(!run.customer_id){const c=await stripe('customers',{name:'BrokerRelay sandbox invoice fixture','metadata[brokerrelay_sandbox_run]':run.id},`br-sandbox-customer-${run.id}`);if(c.livemode!==false)throw new Error('TEST_CUSTOMER_REQUIRED');await checked(db.from('billing_sandbox_runs').update({customer_id:c.id}).eq('id',run.id));run.customer_id=c.id}
   const fields={amount:'2750',currency:'aud',customer:run.customer_id,confirm:'true',off_session:'true','payment_method_types[0]':'au_becs_debit','payment_method_data[type]':'au_becs_debit','payment_method_data[au_becs_debit][bsb_number]':'000000','payment_method_data[au_becs_debit][account_number]':run.scenario==='success'?'000123456':'222222227','payment_method_data[billing_details][name]':'BrokerRelay Test','payment_method_data[billing_details][email]':'billing-test@example.com','mandate_data[customer_acceptance][type]':'offline','metadata[brokerrelay_sandbox_run]':run.id}
   const pi=await stripe('payment_intents',fields,`br-sandbox-invoice-${run.id}`);if(pi.livemode!==false||pi.currency!=='aud'||pi.amount!==2750)throw new Error('TEST_PAYMENT_REQUIRED')
   await checked(db.from('billing_sandbox_runs').update({intent_id:pi.id}).eq('id',run.id));
   // Final financial state is set only by a signed webhook, never this response.
  }else if(body.action!=='refresh')throw new Error('INVALID_ACTION')
  run=await checked(db.from('billing_sandbox_runs').select('*').eq('id',body.id).eq('created_by',user.id).single());return json({run},200,headers)
 }catch(e){console.error('Sandbox invoice:',e instanceof Error?e.message:'ERROR');return json({error:e instanceof Error?e.message:'SANDBOX_TEST_FAILED'},400,headers)}
})
