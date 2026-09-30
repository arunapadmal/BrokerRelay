import { adminClient, checked, cors, json, required, stripe } from '../_shared/billing.ts'
Deno.serve(async (req: Request) => {
 const headers = cors(req); if (req.method === 'OPTIONS') return new Response(null,{headers}); if(req.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405,headers)
 try {
  const auth = req.headers.get('Authorization'); if (!auth?.startsWith('Bearer ')) return json({error:'UNAUTHENTICATED'},401,headers)
  const db = adminClient(); const {data:{user},error} = await db.auth.getUser(auth.slice(7)); if(error || !user) return json({error:'UNAUTHENTICATED'},401,headers)
  // @ts-ignore Deno resolves the pinned remote dependency.
  const {createClient} = await import('https://esm.sh/@supabase/supabase-js@2.95.0')
  const viewer = createClient(required('SUPABASE_URL'),required('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
  const access = await checked(viewer.rpc('get_my_portal_access')); const body = await req.json();
  if(!access?.is_head_broker || access.organisation_id !== body.organisation_id) return json({error:'HEAD_BROKER_REQUIRED'},403,headers)
  const org = body.organisation_id
  if (body.action === 'disable') { await checked(db.from('billing_payment_accounts').update({enabled:false,setup_intent_id:null,updated_at:new Date().toISOString()}).eq('organisation_id',org)); return json({disabled:true},200,headers) }
  const company = await checked(db.from('organisations').select('name,billing_email').eq('id',org).single()); if(!company.billing_email) return json({error:'SET_COMPANY_BILLING_EMAIL_FIRST'},400,headers)
  let account = await checked(db.from('billing_payment_accounts').select('*').eq('organisation_id',org).maybeSingle())
  const live = required('STRIPE_SECRET_KEY').startsWith('sk_live_'); const publicKey = required('STRIPE_PUBLISHABLE_KEY'); if(!/^pk_(live|test)_/.test(publicKey) || publicKey.startsWith('pk_live_')!==live) throw new Error('STRIPE_KEY_MODE_MISMATCH')
  if(!account?.stripe_customer_id) { const customer = await stripe('customers',{name:company.name,email:company.billing_email,'metadata[organisation_id]':org},`brokerrelay-customer-${org}`); await checked(db.from('billing_payment_accounts').upsert({organisation_id:org,stripe_customer_id:customer.id,livemode:live})); account={stripe_customer_id:customer.id} }
  else if(account.livemode !== live) return json({error:'PAYMENT_ACCOUNT_MODE_MISMATCH'},409,headers)
  const intent = await stripe('setup_intents',{customer:account.stripe_customer_id,'payment_method_types[0]':'au_becs_debit',usage:'off_session','metadata[organisation_id]':org})
  await checked(db.from('billing_payment_accounts').update({setup_intent_id:intent.id,updated_at:new Date().toISOString()}).eq('organisation_id',org))
  return json({client_secret:intent.client_secret,publishable_key:publicKey,livemode:live},200,headers)
 } catch(e) { console.error('Billing setup:',e instanceof Error?e.message:'ERROR'); return json({error:e instanceof Error?e.message:'BILLING_SETUP_FAILED'},400,headers) }
})
