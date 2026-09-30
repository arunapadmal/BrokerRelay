import { adminClient, checked, invoiceEmail, json, required, stripe } from '../_shared/billing.ts'
Deno.serve(async (req: Request) => {
 if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405)
 if(req.headers.get('x-billing-token')!==Deno.env.get('BILLING_WORKER_TOKEN') || !Deno.env.get('BILLING_WORKER_TOKEN')) return json({error:'UNAUTHORISED'},401)
 const db=adminClient(); let done=0,waiting=0,review=0
 try {
  const config=await checked(db.from('billing_automation_settings').select('*').eq('id',true).single())
  for(let count=0;count<5;count++) {
   const j=await checked(db.rpc('billing_claim_job')); if(!j) break
   const finish=async (values:Record<string,unknown>)=>checked(db.from('billing_delivery_jobs').update({...values,lease_until:null,lease_token:null}).eq('id',j.id).eq('lease_token',j.lease_token))
   const postpone=async()=>{await finish({state:'pending',available_at:new Date(Date.now()+3600000).toISOString()});waiting++}
   try {
    const i=await checked(db.from('billing_invoices').select('*').eq('id',j.invoice_id).single())
    if(j.kind==='debit') {
     if(i.status==='paid') {await finish({state:'done'});continue}
     if(i.stripe_payment_intent_id) { const pi=await stripe(`payment_intents/${encodeURIComponent(i.stripe_payment_intent_id)}`); await checked(db.rpc('billing_apply_payment',{p_event:null,p_invoice:i.id,p_intent:pi.id,p_customer:pi.customer,p_amount:pi.amount,p_status:pi.status,p_live:pi.livemode})); await finish(pi.status==='processing'?{state:'pending',available_at:new Date(Date.now()+3600000).toISOString()}:{state:'done'});done++;continue }
     const account=await checked(db.from('billing_payment_accounts').select('*').eq('organisation_id',i.organisation_id).maybeSingle())
     if(!config.debit_enabled || !i.invoice_email_sent_at || !account?.ready || !account.enabled || !account.livemode) {await postpone();continue}
     if(!i.notified_mandate_id || i.notified_mandate_id!==account.stripe_mandate_id)throw new Error('NEW_AUTHORISATION_NOTICE_REVIEW_REQUIRED')
     if(Date.now()<new Date(i.debit_at).getTime()) {await postpone();continue}
     if(!required('STRIPE_SECRET_KEY').startsWith('sk_live_')) throw new Error('LIVE_STRIPE_KEY_REQUIRED')

    } else if(!config.email_enabled) {await postpone();continue}
    if(j.kind==='receipt_email' && i.status!=='paid') throw new Error('PAYMENT_NOT_CONFIRMED')
    if(j.kind!=='debit') { required('RESEND_API_KEY');required('BILLING_EMAIL_FROM');required('BILLING_APP_URL'); if(!i.company_snapshot.billing_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.company_snapshot.billing_email))throw new Error('BILLING_EMAIL_MISSING_OR_INVALID') }
    const first=j.first_attempt_at ? new Date(j.first_attempt_at).getTime() : Date.now()
    // Provider idempotency windows are limited: ambiguous old requests require manual reconciliation.
    if(Date.now()-first>20*3600000) throw new Error('IDEMPOTENCY_WINDOW_REVIEW_REQUIRED')
    if(!j.first_attempt_at) await checked(db.from('billing_delivery_jobs').update({first_attempt_at:new Date(first).toISOString()}).eq('id',j.id).eq('lease_token',j.lease_token))
    if(j.kind==='debit') {
     const a=await checked(db.from('billing_payment_accounts').select('*').eq('organisation_id',i.organisation_id).single())
     if(!a.ready || !a.enabled || !a.livemode) {await postpone();continue}
     if(i.total_cents===0) {await checked(db.from('billing_invoices').update({status:'paid',paid_at:new Date().toISOString(),payment_status:'paid',payment_reference:'No payment required'}).eq('id',i.id).eq('status','issued'));await finish({state:'done'});done++;continue}
     const fields:Record<string,string>={amount:String(i.total_cents),currency:'aud',customer:a.stripe_customer_id,payment_method:a.stripe_payment_method_id,'payment_method_types[0]':'au_becs_debit',off_session:'true',confirm:'true','metadata[brokerrelay_invoice_id]':i.id,'metadata[organisation_id]':i.organisation_id,description:`BrokerRelay BR-${String(i.invoice_number).padStart(6,'0')}`}
     if(a.stripe_mandate_id) fields.mandate=a.stripe_mandate_id
     const pi=await stripe('payment_intents',fields,`brokerrelay-invoice-${i.id}`)
     await checked(db.rpc('billing_apply_payment',{p_event:null,p_invoice:i.id,p_intent:pi.id,p_customer:pi.customer,p_amount:pi.amount,p_status:pi.status,p_live:pi.livemode}));await finish(pi.status==='processing'?{state:'pending',provider_id:pi.id,available_at:new Date(Date.now()+3600000).toISOString()}:{state:'done',provider_id:pi.id});done++
    } else {
     const to=i.company_snapshot.billing_email
     if(!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('BILLING_EMAIL_MISSING_OR_INVALID')
     const calendarDate=(time:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time))
     const noticeDate=calendarDate(first)
     if(j.kind==='invoice_email' && noticeDate!==calendarDate(Date.now())) throw new Error('NOTICE_DATE_REVIEW_REQUIRED')
     const noticePlusSeven=new Date(`${noticeDate}T12:00:00Z`);noticePlusSeven.setUTCDate(noticePlusSeven.getUTCDate()+7)
     const collectionDate=[i.due_date,noticePlusSeven.toISOString().slice(0,10)].sort().at(-1)!
     const account=j.kind==='invoice_email'?await checked(db.from('billing_payment_accounts').select('*').eq('organisation_id',i.organisation_id).maybeSingle()):null
     const automatic=!!(config.debit_enabled && account?.ready && account.enabled && account.livemode && account.stripe_mandate_id)
     const displayInvoice=j.kind==='invoice_email'?{...i,debit_at:`${collectionDate}T12:00:00Z`,automatic_collection:automatic,bank_last4:account?.last4,mandate_ref:automatic?account.stripe_mandate_id:null}:i
     const email=invoiceEmail(displayInvoice,j.kind,required('BILLING_APP_URL').replace(/\/$/,''))
     const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${required('RESEND_API_KEY')}`,'Content-Type':'application/json','Idempotency-Key':`brokerrelay-${j.kind}-${i.id}`},body:JSON.stringify({from:required('BILLING_EMAIL_FROM'),to:[to],...email}),signal:AbortSignal.timeout(20000)})
     if(!response.ok) throw new Error(`EMAIL_PROVIDER_${response.status}`)
     const sent=await response.json();const now=new Date().toISOString()
     if(j.kind==='invoice_email') {
      // Seven local calendar days after successful notice; late emails extend collection.
      await checked(db.rpc('billing_notice_sent',{p_invoice:i.id,p_sent:now,p_notice_date:noticeDate,p_mandate:automatic?account.stripe_mandate_id:null}))
     } else if(j.kind==='receipt_email') await checked(db.from('billing_invoices').update({receipt_email_sent_at:now,delivery_error:null}).eq('id',i.id))
     await finish({state:'done',provider_id:sent.id});done++
    }
   } catch(e) {
    const code=e instanceof Error?e.message:'BILLING_WORKER_ERROR';const safe=/^[A-Z0-9_]+$/.test(code)?code:'BILLING_WORKER_ERROR'
    const block=/MISSING_|INVALID|REQUIRED|MISMATCH|NOT_CONFIRMED|STRIPE_(CARD_DECLINED|BANK_ACCOUNT_DECLINED|PAYMENT_INTENT|RESOURCE_MISSING)/.test(safe) || j.attempts>=8
    await finish({state:block?'review':'pending',available_at:new Date(Date.now()+1800000).toISOString(),error_code:safe})
    await checked(db.from('billing_invoices').update({delivery_error:safe}).eq('id',j.invoice_id));review++
   }
  }
  return json({done,waiting,review})
 } catch { return json({error:'BILLING_WORKER_DATABASE_ERROR'},500) }
})
