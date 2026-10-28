'use client'
import { useEffect,useState } from 'react'
import { supabase } from '@/lib/supabase'
type Data={commissions:{id:string;company_name:string;status:string;commission_cents:number;created_at:string}[];offers:{id:string;terms_version:string;privacy_version:string;created_at:string;accepted_at:string|null}[];events:{id:string;event_type:string;created_at:string}[]}
export function PartnerRecordDetails({partnerId,tab}:{partnerId:string;tab:'income'|'history'}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState('')
 useEffect(()=>{let live=true;setData(null);setError('');void supabase.rpc('partner_admin_details',{p_id:partnerId}).then(r=>{if(!live)return;if(r.error)setError(r.error.message);else setData(r.data)});return()=>{live=false}},[partnerId])
 if(error)return <p role="alert" className="notice error">{error}</p>
 if(!data)return <p>Loading records…</p>
 const money=(c:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(c/100)
 if(tab==='income')return <div><h3>Recorded commission</h3><div className="billingStats">{[['Approved + paid',['approved','paid']],['Awaiting approval',['pending','eligible']],['Paid',['paid']]].map(([label,statuses])=><div key={String(label)}><small>{label}</small><strong>{money(data.commissions.filter(c=>(statuses as string[]).includes(c.status)).reduce((n,c)=>n+c.commission_cents,0))}</strong></div>)}</div><p className="muted">Recorded setup commissions only. Automatic recurring calculation and payouts are not enabled.</p><div className="tableWrap"><table><thead><tr><th>Company</th><th>Commission</th><th>Status</th></tr></thead><tbody>{data.commissions.map(c=><tr key={c.id}><td>{c.company_name}</td><td>{money(c.commission_cents)}</td><td>{c.status}</td></tr>)}</tbody></table>{!data.commissions.length&&<p>No commission entries recorded.</p>}</div></div>
 return <div><h3>Agreement versions</h3>{data.offers.length?data.offers.map(o=><p key={o.id}><strong>{o.terms_version}</strong> · {o.accepted_at?'Accepted '+new Date(o.accepted_at).toLocaleString('en-AU'):'Not accepted'}<small className="blockText">Privacy: {o.privacy_version} · Offer {o.id}</small></p>):<p>No offers recorded.</p>}<h3>Audit history</h3>{data.events.length?data.events.map(e=><p key={e.id}>{e.event_type.replaceAll('_',' ')}<small className="blockText">{new Date(e.created_at).toLocaleString('en-AU')}</small></p>):<p>No audit events recorded.</p>}</div>
}
