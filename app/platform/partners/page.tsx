'use client'
import { PLATFORM_OWNER_EMAIL } from '@/lib/platform-owner'
import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'

type Partner = {id:string;partner_code:string;display_name:string;contact_email:string|null;status:string}
type Company = {id:string;name:string}
type Referral = {id:string;organisation_id:string;company_name:string;referring_partner_id:string|null;assigned_account_manager_id:string|null}
type Dashboard = {partners:Partner[];companies:Company[];referrals:Referral[]}
const empty:Dashboard = {partners:[],companies:[],referrals:[]}
export default function PartnerAdminPage(){
 const [ready,setReady]=useState(false),[data,setData]=useState<Dashboard>(empty)
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const [companyId,setCompanyId]=useState(''),[referrerId,setReferrerId]=useState(''),[managerId,setManagerId]=useState('')
 async function reload(){
  const {data:result,error:e}=await supabase.rpc('m7_admin_partner_dashboard')
  if(e){setError(e.message);return}
  setData(result as Dashboard);setError('')
 }
 useEffect(()=>{void(async()=>{
  const {data:user}=await supabase.auth.getUser()
  if(!user.user){window.location.href='/login';return}
  const {data:owner}=await supabase.from('platform_admins').select('user_id').eq('user_id',user.user.id).maybeSingle()
  if(!owner||user.user.email?.toLowerCase()!==PLATFORM_OWNER_EMAIL){window.location.href='/dashboard';return}
  setReady(true);await reload()
 })()},[])
 async function createPartner(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;const form=e.currentTarget;const f=new FormData(form)
  setBusy(true);setError('');setNotice('')
  const {error:x}=await supabase.rpc('m7_admin_create_partner',{
   p_name:String(f.get('name')||''),p_email:String(f.get('email')||''),p_abn:String(f.get('abn')||'')
  })
  if(x)setError(x.message);else{setNotice('Partner created as draft; agreement and verification are required before commissions can be paid.');form.reset();await reload()}
  setBusy(false)
 }
 async function assign(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||!companyId)return;setBusy(true);setError('');setNotice('')
  const {error:x}=await supabase.rpc('m7_admin_assign_company_partner',{
   p_organisation_id:companyId,p_referring_partner_id:referrerId||null,p_account_manager_id:managerId||null
  })
  if(x)setError(x.message);else{setNotice('Company partner assignment saved. No commission or payment has been created.');await reload()}
  setBusy(false)
 }
 function pickCompany(id:string){setCompanyId(id);const r=data.referrals.find(x=>x.organisation_id===id);setReferrerId(r?.referring_partner_id||'');setManagerId(r?.assigned_account_manager_id||'')}
 if(!ready)return <main className="page"><p>Checking platform access…</p></main>
 return <main className="platformShell"><header className="platformHeader"><BrokerRelayBrand compact/><Link href="/platform/companies">Platform companies</Link></header><div className="platformBody"><nav className="platformSidebar" aria-label="Platform navigation"><Link href="/platform/companies">▦ Companies</Link><Link href="/platform/billing">▤ Billing &amp; plans</Link><Link className="platformNavActive" aria-current="page" href="/platform/partners">♧ Partners</Link><Link href="/platform/operations">◉ Operations</Link><div className="platformSidebarBottom"><Link href="/dashboard">⌂ Broker Desk</Link></div></nav><div className="platformMain"><div className="platformHeading"><div><h1>Partners &amp; referrals</h1><p className="muted">Independent contractor records and company attribution. Referral commission is 20% of eligible collected setup fees, subject to agreement and approval.</p></div></div>
 {error&&<p role="alert" className="notice error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
 <section className="card billingPanel"><h2>Register Partner Account Manager</h2><p className="muted">New partners start in draft status; this form does not activate payments or contractor access.</p><form className="billingForm" onSubmit={createPartner}><label>Name<input name="name" minLength={2} maxLength={160} required/></label><label>Email<input name="email" type="email" required/></label><label>ABN (optional)<input name="abn" maxLength={30}/></label><button disabled={busy}>Create draft partner</button></form></section>
 <section className="card billingPanel"><h2>Assign brokerage</h2><form className="billingForm" onSubmit={assign}><label>Company<select required value={companyId} onChange={e=>pickCompany(e.target.value)}><option value="">Select company…</option>{data.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Referred by<select value={referrerId} onChange={e=>setReferrerId(e.target.value)}><option value="">None</option>{data.partners.map(p=><option key={p.id} value={p.id}>{p.display_name} ({p.partner_code})</option>)}</select></label><label>Account manager<select value={managerId} onChange={e=>setManagerId(e.target.value)}><option value="">None</option>{data.partners.map(p=><option key={p.id} value={p.id}>{p.display_name} ({p.partner_code})</option>)}</select></label><button disabled={busy||!companyId||(!referrerId&&!managerId)}>Save assignment</button></form></section>
 <section className="card billingPanel"><h2>Registered partners</h2><div className="tableWrap"><table><thead><tr><th>Partner</th><th>Code</th><th>Email</th><th>Status</th></tr></thead><tbody>{data.partners.map(p=><tr key={p.id}><td>{p.display_name}</td><td>{p.partner_code}</td><td>{p.contact_email||'—'}</td><td>{p.status}</td></tr>)}</tbody></table></div>{!data.partners.length&&<p className="muted">No partners registered yet.</p>}</section>
 <section className="card billingPanel"><h2>Company assignments</h2><div className="tableWrap"><table><thead><tr><th>Company</th><th>Referrer</th><th>Account manager</th></tr></thead><tbody>{data.referrals.map(r=><tr key={r.id}><td>{r.company_name}</td><td>{data.partners.find(p=>p.id===r.referring_partner_id)?.display_name||'—'}</td><td>{data.partners.find(p=>p.id===r.assigned_account_manager_id)?.display_name||'—'}</td></tr>)}</tbody></table></div></section>
 </div></div></main>
}
