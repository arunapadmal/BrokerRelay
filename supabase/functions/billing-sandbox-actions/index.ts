import {adminClient,checked,cors,json,required,stripe,invoiceEmail} from '../_shared/billing.ts'
import {assertSandboxEnvironment} from '../_shared/sandbox.ts'
import {reconcileRefund} from '../_shared/refunds.ts'
Deno.serve(async(req:Request)=>{
 const headers=cors(req);if(req.method==='OPTIONS')return new Response(null,{headers});if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405,headers)
 try{
  assertSandboxEnvironment(n=>Deno.env.get(n));const db=adminClient(),auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return json({error:'UNAUTHENTICATED'},401,headers)
  const {data:{user},error}=await db.auth.getUser(auth.slice(7));if(error||!user)return json({error:'UNAUTHENTICATED'},401,headers)
  if(!await checked(db.from('platform_admins').select('user_id').eq('user_id',user.id).maybeSingle()))return json({error:'OWNER_REQUIRED'},403,headers)
  const body=await req.json()
  if(body.action==='diagnostics')return json({mode:'sandbox',email_missing:['RESEND_API_KEY','BILLING_EMAIL_FROM'].filter(n=>!Deno.env.get(n)),test_email_recipient:user.email,worker_token_configured:!!Deno.env.get('BILLING_WORKER_TOKEN')},200,headers)
  if(!/^[0-9a-f-]{36}$/i.test(body.invoice_id??''))throw new Error('INVOICE_REQUIRED')
  const i=await checked(db.from('billing_invoices').select('*').eq('id',body.invoice_id).single())
  if(body.action==='schedule'){
   if(body.sandbox_ack!==true||i.status!=='issued'||i.stripe_payment_intent_id)throw new Error('UNPAID_UNSUBMITTED_INVOICE_REQUIRED')
   const a=await checked(db.from('billing_payment_accounts').select('*').eq('organisation_id',i.organisation_id).single())
   if(a.livemode||!a.ready||!a.enabled||!a.stripe_mandate_id)throw new Error('HEAD_BROKER_TEST_AUTHORISATION_REQUIRED')
   await checked(db.rpc('billing_register_sandbox_invoice',{p_invoice:i.id,p_customer:a.stripe_customer_id,p_owner:user.id}))
   await checked(db.from('billing_invoice_payment_context').update({scheduled:true}).eq('invoice_id',i.id))
   const j=await checked(db.from('billing_delivery_jobs').select('*').eq('invoice_id',i.id).eq('kind','invoice_email').maybeSingle())
   if(j?.first_attempt_at||i.invoice_email_sent_at)throw new Error('EXISTING_NOTICE_REVIEW_REQUIRED')
   if(j)await checked(db.from('billing_delivery_jobs').update({state:'review',error_code:'SANDBOX_EMAIL_HELD'}).eq('id',j.id));else await checked(db.from('billing_delivery_jobs').insert({invoice_id:i.id,kind:'invoice_email',state:'review',error_code:'SANDBOX_EMAIL_HELD'}))
   return json({message:'Schedule prepared. Send the sandbox invoice notice to yourself to start the seven-day waiting period.'},200,headers)
  }
  const ctx=await checked(db.from('billing_invoice_payment_context').select('*').eq('invoice_id',i.id).single());if(ctx.mode!=='sandbox'||(!ctx.intent_id&&!(body.action==='email'&&body.kind==='invoice_email')))throw new Error('SUBMITTED_SANDBOX_INVOICE_REQUIRED')
  const pi=ctx.intent_id?await stripe(`payment_intents/${encodeURIComponent(ctx.intent_id)}`):null
  if(pi&&(pi.livemode!==false||pi.customer!==ctx.customer_id||pi.amount!==i.total_cents||pi.currency!=='aud'))throw new Error('PAYMENT_MISMATCH')
  if(body.action==='email'){
   required('RESEND_API_KEY');required('BILLING_EMAIL_FROM');if(!user.email||!user.email_confirmed_at)throw new Error('VERIFIED_OWNER_EMAIL_REQUIRED')
   const kind=body.kind;if(!['invoice_email','receipt_email','failure_email'].includes(kind))throw new Error('EMAIL_KIND_REQUIRED')
   if(kind==='receipt_email'&&i.status!=='paid')throw new Error('PAID_RECEIPT_REQUIRED')
   if(kind==='failure_email'&&(!pi||!['requires_payment_method','canceled'].includes(pi.status)))throw new Error('CONFIRMED_FAILURE_REQUIRED')
   const lease=crypto.randomUUID();const j=await checked(db.rpc('billing_claim_sandbox_email',{p_invoice:i.id,p_kind:kind,p_owner:user.id,p_lease:lease}))
   try{
    let display=i,noticeDate='',mandate=''
    if(kind==='invoice_email'){
     const a=await checked(db.from('billing_payment_accounts').select('*').eq('organisation_id',i.organisation_id).single())
     if(!ctx.scheduled||a.livemode||!a.ready||!a.enabled||a.stripe_customer_id!==ctx.customer_id)throw new Error('SCHEDULED_TEST_AUTHORISATION_REQUIRED')
     const date=(v:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))
     noticeDate=date(j.first_attempt_at);if(noticeDate!==date(new Date().toISOString()))throw new Error('NOTICE_DATE_REVIEW_REQUIRED')
     const due=new Date(noticeDate+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+7);mandate=a.stripe_mandate_id
     display={...i,debit_at:due.toISOString(),automatic_collection:true,bank_last4:a.last4,mandate_ref:mandate}
    }
    const preview=invoiceEmail(display,kind,'https://brokerrelaydev.netlify.app')
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${required('RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`br-sandbox-email-${j.id}`},body:JSON.stringify({from:required('BILLING_EMAIL_FROM'),to:[user.email],subject:'[SANDBOX — NO MONEY COLLECTED] '+preview.subject,text:'SANDBOX TEST. No real money collected. Sent only to the Platform Owner.\n\n'+preview.text.replace(/\\n/g,'\n'),html:'<p><strong>SANDBOX TEST — NO MONEY COLLECTED. Sent only to the Platform Owner.</strong></p>'+preview.html}),signal:AbortSignal.timeout(20000)})
    if(!response.ok)throw new Error(`EMAIL_PROVIDER_${response.status}`);const sent=await response.json()
    if(kind==='invoice_email')await checked(db.rpc('billing_notice_sent',{p_invoice:i.id,p_sent:new Date().toISOString(),p_notice_date:noticeDate,p_mandate:mandate}))
    await checked(db.from('billing_sandbox_email_deliveries').upsert({job_id:j.id,owner_id:user.id,recipient:user.email,provider_id:sent.id},{onConflict:'job_id'}))
    await checked(db.from('billing_delivery_jobs').update({state:'done',error_code:null,provider_id:sent.id,lease_token:null,lease_until:null}).eq('id',j.id).eq('lease_token',lease))
    return json({accepted:true,to:user.email,message:'Provider accepted the test email; inbox delivery still needs confirmation.'},200,headers)
   }catch(e){await checked(db.from('billing_delivery_jobs').update({state:'review',error_code:'SANDBOX_EMAIL_HELD',lease_token:null,lease_until:null}).eq('id',j.id).eq('lease_token',lease));throw e}
  }
  if(!['retry','refund'].includes(body.action)||body.sandbox_ack!==true||!/^[0-9a-f-]{36}$/i.test(body.request_id??''))throw new Error('SANDBOX_ACTION_CONFIRMATION_REQUIRED')
  if(!pi)throw new Error('PAYMENT_REQUIRED')
  if(body.action==='retry'&&(i.status==='paid'||pi.status!=='requires_payment_method'))throw new Error('FAILED_UNPAID_PAYMENT_REQUIRED')
  const amount=body.action==='refund'?Number(body.amount_cents):0
  if(body.action==='refund'&&(i.status!=='paid'||pi.status!=='succeeded'||!Number.isInteger(amount)||amount<1||amount>i.total_cents))throw new Error('VALID_REFUND_AMOUNT_REQUIRED')
  await checked(db.from('billing_sandbox_actions').upsert({id:body.request_id,invoice_id:i.id,owner_id:user.id,kind:body.action,amount_cents:amount},{onConflict:'id',ignoreDuplicates:true}))
  const action=await checked(db.from('billing_sandbox_actions').select('*').eq('id',body.request_id).single())
  if(action.invoice_id!==i.id||action.owner_id!==user.id||action.kind!==body.action||action.amount_cents!==amount)throw new Error('ACTION_ID_CONFLICT')
  if(action.provider_id)return json({submitted:true,reference:action.provider_id},200,headers)
  if(Date.now()-new Date(action.created_at).getTime()>20*3600000)throw new Error('ACTION_RECONCILIATION_REVIEW_REQUIRED')
  let result:any
  if(body.action==='retry'){
   const fields:Record<string,string>={'payment_method_data[type]':'au_becs_debit','payment_method_data[au_becs_debit][bsb_number]':'000000','payment_method_data[au_becs_debit][account_number]':'000123456','payment_method_data[billing_details][name]':'BrokerRelay Test','payment_method_data[billing_details][email]':'billing-test@example.com','mandate_data[customer_acceptance][type]':'offline'}
   result=await stripe(`payment_intents/${encodeURIComponent(pi.id)}/confirm`,fields,`br-sandbox-retry-${action.id}`)
  }else{result=await stripe('refunds',{payment_intent:pi.id,amount:String(amount)},`br-sandbox-refund-${action.id}`)}
  await checked(db.from('billing_sandbox_actions').update({provider_id:result.id}).eq('id',action.id))
  return json({submitted:true,reference:result.id,message:'Awaiting verified Stripe result.'},200,headers)
 }catch(e){console.error('Sandbox billing action:',e instanceof Error?e.message:'ERROR');return json({error:e instanceof Error?e.message:'SANDBOX_ACTION_FAILED'},400,headers)}
})
