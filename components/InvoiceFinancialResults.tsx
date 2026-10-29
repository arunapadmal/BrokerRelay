'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {money} from '@/lib/billing'
type Invoice={id:string;invoice_number:number;status:string;payment_status:string;total_cents:number}
type Receipt={invoice_id:string;receipt_number:string;snapshot:{total_cents:number;payment_intent:string;notice:string;received_at:string}}
type Commission={invoice_id:string;eligible_base_cents:number;commission_cents:number;status:string}
export function InvoiceFinancialResults({companyId,owner=false,partner=false}:{companyId?:string;owner?:boolean;partner?:boolean}){
 const [invoices,setInvoices]=useState<Invoice[]>([]),[receipts,setReceipts]=useState<Receipt[]>([]),[commissions,setCommissions]=useState<Commission[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 async function load(){
  const c=await supabase.from('billing_invoice_commissions').select('invoice_id,eligible_base_cents,commission_cents,status');if(c.error)throw c.error;setCommissions(c.data??[])
  if(!companyId)return
  const i=await supabase.from('billing_invoices').select('id,invoice_number,status,payment_status,total_cents').eq('organisation_id',companyId).order('invoice_number',{ascending:false});if(i.error)throw i.error;setInvoices(i.data??[])
  const r=await supabase.from('billing_invoice_receipts').select('invoice_id,receipt_number,snapshot').in('invoice_id',(i.data??[]).map(x=>x.id));if(r.error)throw r.error;setReceipts(r.data??[])
 }
 useEffect(()=>{void load().catch(e=>setError(e.message))},[companyId])
 async function test(id:string,scenario:string){if(!window.confirm('Run a Stripe sandbox test against this development invoice? It may be marked TEST PAID. No real money will be collected.'))return;setBusy(true);setError('');setNotice('');try{const r=await supabase.functions.invoke('billing-invoice-test',{body:{invoice_id:id,scenario,sandbox_ack:true}});if(r.error){let m='Invoice test failed';try{m=(await r.error.context.json()).error||m}catch{}throw new Error(m)}if(r.data?.error)throw new Error(r.data.error);setNotice('Test submitted. Refresh after Stripe confirms the result.');await load()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const ids=new Set(invoices.map(i=>i.id)),visible=partner?commissions:commissions.filter(c=>ids.has(c.invoice_id))
 return <section className="billingForm"><h3>{partner?'Sandbox commission accruals':'Invoice payment reconciliation'}</h3><p className="notice">Sandbox results only. Test commissions are excluded from real income and payouts. Receipt emails are held for review.</p>{error&&<p role="alert" className="notice error">{error}</p>}{notice&&<p role="status">{notice}</p>}<button className="secondary" disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>Refresh financial results</button>
 {!partner&&<div className="tableWrap"><table><thead><tr><th>Invoice</th><th>Amount</th><th>Payment</th><th>Sandbox test</th></tr></thead><tbody>{invoices.map(i=><tr key={i.id}><td>BR-{String(i.invoice_number).padStart(6,'0')}</td><td>{money(i.total_cents)}</td><td>{i.payment_status}</td><td>{owner&&i.status==='issued'&&<><button disabled={busy} onClick={()=>void test(i.id,'success')}>Test success</button>{' '}<button disabled={busy} onClick={()=>void test(i.id,'failure')}>Test failure</button></>}</td></tr>)}</tbody></table></div>}
 {receipts.map(r=><article className="card" key={r.invoice_id}><h4>{r.receipt_number}</h4><strong>{r.snapshot.notice}</strong><p>Test payment confirmed: {money(r.snapshot.total_cents)} · {new Date(r.snapshot.received_at).toLocaleString('en-AU')}</p><p>Stripe reference: {r.snapshot.payment_intent}</p><p>Receipt email held; no message sent.</p></article>)}
 {(owner||partner)&&<><div className="tableWrap"><table><thead><tr><th>Invoice reference</th><th>Eligible fees ex GST</th><th>Test commission</th><th>Status</th></tr></thead><tbody>{visible.map(c=><tr key={c.invoice_id}><td>{c.invoice_id}</td><td>{money(c.eligible_base_cents)}</td><td>{money(c.commission_cents)}</td><td>{c.status} · sandbox only</td></tr>)}</tbody></table></div>{!visible.length&&<p className="muted">No eligible sandbox commissions. A successful subscription payment earns no commission under a setup-only agreement.</p>}</> }
 </section>
}
