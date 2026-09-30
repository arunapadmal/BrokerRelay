'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
type PaymentElement = { mount: (target: HTMLElement) => void; destroy: () => void }
type Elements = { create: (name: string) => PaymentElement }
type StripeBrowser = { elements: (options: unknown) => Elements; confirmSetup: (options: unknown) => Promise<{error?: {message?: string}}> }
declare global { interface Window { Stripe?: (key: string) => StripeBrowser } }
let stripeScript: Promise<void> | null = null
function loadStripe() { if (window.Stripe) return Promise.resolve(); if (!stripeScript) stripeScript = new Promise((resolve,reject) => { const script=document.createElement('script');script.src='https://js.stripe.com/v3/';script.onload=()=>resolve();script.onerror=()=>{stripeScript=null;reject(new Error('Could not load the secure payment form.'))};document.head.appendChild(script) });return stripeScript }
export function CompanyAutomaticPayments({companyId,owner}:{companyId:string;owner:boolean}) {
 const [state,setState]=useState<{ready:boolean;enabled:boolean;livemode:boolean;last4?:string}|null>(null)
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[open,setOpen]=useState(false)
 const host=useRef<HTMLDivElement>(null),stripe=useRef<StripeBrowser|null>(null),elements=useRef<Elements|null>(null),payment=useRef<PaymentElement|null>(null)
 async function refresh() { const r=await supabase.rpc('billing_payment_status',{p_org:companyId});if(!r.error)setState(r.data) }
 useEffect(()=>{setOpen(false);setState(null);void refresh();return()=>{payment.current?.destroy();payment.current=null}},[companyId])
 useEffect(()=>{if(open && payment.current && host.current)payment.current.mount(host.current)},[open])
 async function setup() {
  setBusy(true);setError('');setNotice('')
  try {
   const {data,error:failure}=await supabase.functions.invoke('billing-payment-setup',{body:{organisation_id:companyId}})
   if(failure)throw new Error('Automatic payments are not available yet. Ask the Platform Owner to check the payment gateway setup.')
   if(data.error)throw new Error(data.error)
   await loadStripe(); stripe.current=window.Stripe!(data.publishable_key);elements.current=stripe.current.elements({clientSecret:data.client_secret,appearance:{theme:'stripe'}})
   payment.current?.destroy();payment.current=elements.current.create('payment');setOpen(true);setConsent(false)
   if(!data.livemode)setNotice('Test authorisation only. It will not enable collection of real invoices.')
  } catch(e) {setError(e instanceof Error?e.message:'Could not start payment setup.')}finally{setBusy(false)}
 }
 async function confirm() {
  if(!consent || !stripe.current || !elements.current)return
  setBusy(true);setError('')
  try {const r=await stripe.current.confirmSetup({elements:elements.current,confirmParams:{return_url:`${window.location.origin}/billing`},redirect:'if_required'});if(r.error)throw new Error(r.error.message||'Authorisation failed.');payment.current?.destroy();payment.current=null;setOpen(false);setNotice('Authorisation submitted. Stripe confirmation may take a moment; refresh the status below.');await refresh()}catch(e){setError(e instanceof Error?e.message:'Authorisation failed.')}finally{setBusy(false)}
 }
 async function disable() {
  if(!window.confirm('Stop future automatic collection for your company? A payment already submitted may still complete.'))return
  setBusy(true);setError('')
  try{const r=await supabase.functions.invoke('billing-payment-setup',{body:{organisation_id:companyId,action:'disable'}});if(r.error||r.data?.error)throw new Error('Could not stop automatic payments.');await refresh();setNotice('Future automatic collection stopped.')}catch(e){setError(e instanceof Error?e.message:'Could not update payment settings.')}finally{setBusy(false)}
 }
 return <div className="billingForm billingNoPrint"><h3>Automatic direct debit</h3><p className="muted">Monthly invoices cover the previous month. Collection starts seven days after the invoice notice. A receipt is emailed after successful payment. New or changed bank authorisations apply to future invoice notices; an existing invoice may need manual payment.</p>
 {state && <p>{state.ready && state.enabled ? state.livemode ? `Authorised · bank account ending ${state.last4 || '••••'}` : 'Test authorisation · live collection unavailable' : 'Automatic payments are not authorised.'}</p>}
 {error && <p className="notice error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
 {!owner && !open && <div className="billingInvoiceList"><button type="button" disabled={busy} onClick={()=>void setup()}>{state?.ready?'Update debit authorisation':'Set up direct debit'}</button>{state?.enabled && <button type="button" className="secondary" disabled={busy} onClick={()=>void disable()}>Stop automatic payments</button>}</div>}
 <div ref={host} hidden={!open} />
 {open && <><label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I authorise monthly collection of my company invoices, including GST and applicable usage fees, after seven days’ invoice notice.</label><button type="button" disabled={busy||!consent} onClick={()=>void confirm()}>Authorise direct debit</button><p className="muted">Bank details are collected securely by Stripe. BrokerRelay stores the authorisation reference and last four digits.</p></>}
 {owner && <p className="muted">The company’s Head Broker must authorise payments from their own billing page.</p>}
 <button className="secondary" type="button" disabled={busy} onClick={()=>void refresh()}>Refresh payment status</button>
 </div>
}
