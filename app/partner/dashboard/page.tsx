'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { sendInvitationEmail } from '@/lib/send-invitation-email'
import { companySetupUrl } from '@/lib/company-invitation-url'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'
import { PartnerTransfers } from '@/components/PartnerTransfers'
import '@/components/billing.css'
import './partner-dashboard.css'

type Invitation = {id:string;head_name:string;head_email:string;created_at:string;expires_at:string;completed_at:string|null;status:string;company_name:string|null;simulated?:boolean}
type Commission = {id:string;company_name:string;status:string;commission_cents:number;created_at:string;paid_at:string|null}
type Dashboard = {
 partner:{id:string;name:string;partner_code:string;status:string;accepted:boolean;is_referrer:boolean};can_invite:boolean
 invitations:Invitation[];commissions:Commission[];companies:{id:string;name:string;referred_at:string}[]
 stats:{invited:number;accepted:number;pending:number;expired:number;gross_income_cents:number;paid_cents:number;pending_cents:number}
}
const money=(c:number)=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(c/100)
const date=(value:string)=>new Date(value).toLocaleDateString('en-AU',{timeZone:'Australia/Melbourne'})
export default function PartnerDashboard(){
 const [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[filter,setFilter]=useState('all')
 async function load(){
  const {data:auth}=await supabase.auth.getUser()
  if(!auth.user){window.location.replace('/login');return}
  const r=await supabase.rpc('partner_dashboard')
  if(r.error){setError(r.error.message);return}
  const simulated=await supabase.rpc('partner_demo_company_history')
  if(simulated.error){setError(simulated.error.message);return}
  const result=r.data as Dashboard
  const invitations=[...result.invitations,...(simulated.data??[]) as Invitation[]].sort((a,b)=>b.created_at.localeCompare(a.created_at))
  setData({...result,invitations,stats:{...result.stats,invited:invitations.length,accepted:invitations.filter(i=>i.status==='accepted').length,pending:invitations.filter(i=>i.status==='pending').length,expired:invitations.filter(i=>i.status==='expired').length}})
 }
 useEffect(()=>{void load()},[])
 async function invite(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return
  const form=e.currentTarget,f=new FormData(form),email=String(f.get('email')).trim().toLowerCase()
  setBusy(true);setError('');setNotice('')
  try{
   const saved=await supabase.rpc('partner_invite_company',{p_name:String(f.get('name')),p_email:email,p_mobile:String(f.get('mobile'))})
   if(saved.error)throw saved.error
   form.reset()
   try{await sendInvitationEmail(email,companySetupUrl());setNotice('Invitation email requested. The referral is recorded under your name; email acceptance does not confirm inbox delivery.')}
   catch(x){setError('Invitation saved under your name. Email delivery needs attention: '+(x as Error).message+' Use Resend below after resolving the issue.')}
   await load()
  }catch(x){setError((x as Error).message)}finally{setBusy(false)}
 }
 async function resend(i:Invitation){
  if(busy)return;setBusy(true);setError('');setNotice('')
  try{
   const r=await supabase.rpc('partner_prepare_company_resend',{p_invitation_id:i.id});if(r.error)throw r.error
   await sendInvitationEmail(String(r.data),companySetupUrl())
   setNotice('Invitation renewed for seven days and email requested. Ask the Head Broker to use the latest email link.')
  }catch(x){setError((x as Error).message)}finally{await load();setBusy(false)}
 }
 async function signOut(){const r=await supabase.auth.signOut();if(r.error){setError(r.error.message);return}window.location.replace('/login')}
 if(!data)return <main className="page"><BrokerRelayBrand/><p role="status">{error||'Opening your partner dashboard…'}</p><Link href="/login">Return to sign in</Link></main>
 const shown=data.invitations.filter(i=>filter==='all'||i.status===filter)
 return <main className="platformShell partnerDashboard"><header className="platformHeader"><BrokerRelayBrand compact/><details className="platformAccount"><summary aria-label={'My account: '+data.partner.name}><span className="platformAvatar" aria-hidden="true">{data.partner.name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'P'}</span><span className="partnerAccountIdentity"><strong>{data.partner.name}</strong><small>{data.partner.is_referrer?'Referral partner':'Account manager'}</small></span><span className="platformChevron" aria-hidden="true">⌄</span></summary><div className="platformAccountMenu"><Link href="/partner/dashboard">Partner dashboard</Link><Link href="/account/password">Change password</Link><Link href="/partner/accept">My agreement &amp; privacy</Link><button onClick={()=>void signOut()}>Sign out</button></div></details></header><div className="platformBody">
 <nav className="partnerNav" aria-label="Partner navigation"><Link href="/partner/dashboard" aria-current="page">Dashboard</Link><a href="#invite-company">Invite a company</a><a href="#my-invitations">My invitations</a><a href="#my-income">Commission income</a></nav>
 <div className="platformMain"><div className="platformHeading"><div><p className="eyebrow">REFERRAL PARTNER</p><h1>Welcome, {data.partner.name}</h1><p>{data.partner.partner_code} · <strong>{data.partner.status}</strong></p></div><button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>Refresh</button></div>
 {error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 {!data.can_invite&&<p className="notice">{!data.partner.accepted?<>Accept your current <Link href="/partner/accept">partner agreement</Link> first.</>:data.partner.status!=='active'?'Your agreement is accepted. Company invitations become available after the platform owner activates your referral-partner account. Suspended or closed accounts cannot send invitations.':!data.partner.is_referrer?'Your account-manager role does not include sending referrals. Contact the owner to request the referral role.':'Your offer is not effective yet. Invitations become available from its effective date.'}</p>}
 <section className="billingStats" aria-label="Partner summary"><div><small>Companies invited</small><strong>{data.stats.invited}</strong><span>All invitation records</span></div><div><small>Accepted invitations</small><strong>{data.stats.accepted}</strong><span>Company setup completed</span></div><div><small>Pending invitations</small><strong>{data.stats.pending}</strong><span>{data.stats.expired} expired</span></div><div><small>Gross commission income</small><strong>{money(data.stats.gross_income_cents)}</strong><span>Recorded approved + paid commission</span></div></section>
 <section id="invite-company" className="card billingPanel"><h2>Invite a brokerage company</h2><p>Enter the Head Broker’s details with their permission. This invitation and the completed company will be attributed to <strong>{data.partner.name}</strong>.</p><form className="billingForm" onSubmit={invite}><fieldset disabled={busy||!data.can_invite}><legend>Head Broker contact</legend><label>Full name<input name="name" required minLength={2} maxLength={160} autoComplete="name"/></label><label>Email address<input name="email" type="email" required maxLength={320} autoComplete="email"/></label><label>Australian mobile<input name="mobile" type="tel" required placeholder="04xx xxx xxx or +614xx xxx xxx" autoComplete="tel"/></label><label className="check"><input type="checkbox" required/>I have permission to share these contact details and send this company invitation.</label><button disabled={busy||!data.can_invite}>Send company setup invitation</button></fieldset></form></section>
 <section id="my-invitations" className="card billingPanel"><div className="billingInvoiceHeading"><div><h2>My invitations</h2><p>Accepted means company setup is complete. Pending does not confirm email delivery. Demo entries are simulated onboarding records, with no email or legal acceptance implied.</p></div><label>Status<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All invitations</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select></label></div><div className="tableWrap"><table><thead><tr><th>Head Broker / company</th><th>Email</th><th>Invited</th><th>Status</th><th>Action</th></tr></thead><tbody>{shown.map(i=><tr key={i.id}><td><strong>{i.company_name||i.head_name}</strong>{i.company_name&&<><br/>{i.head_name}</>}</td><td>{i.head_email}{i.simulated&&<small className="blockText">Demo · simulated</small>}</td><td>{date(i.created_at)}</td><td><span className={'partnerStatus '+i.status}>{i.status}</span><br/><small>{i.status==='accepted'&&i.completed_at?'Completed '+date(i.completed_at):i.status==='pending'?'Expires '+date(i.expires_at):''}</small></td><td>{!i.simulated&&['pending','expired'].includes(i.status)&&<button className="secondary" disabled={busy||!data.can_invite} onClick={()=>void resend(i)}>Resend invitation</button>}</td></tr>)}</tbody></table>{!shown.length&&<p>No invitations in this view.</p>}</div></section>
 <section className="card billingPanel"><h2>My referred companies</h2><p>Includes companies attributed to you by the platform owner.</p>{data.companies.length?<ul>{data.companies.map(c=><li key={c.id}><strong>{c.name}</strong> · referred {date(c.referred_at)}</li>)}</ul>:<p>No companies have completed setup under your referral yet.</p>}</section>
 <section id="my-income" className="card billingPanel"><h2>Commission income</h2><div className="billingStats"><div><small>Gross recorded income</small><strong>{money(data.stats.gross_income_cents)}</strong><span>Approved and paid entries</span></div><div><small>Paid</small><strong>{money(data.stats.paid_cents)}</strong><span>Included in gross income above</span></div><div><small>Awaiting approval</small><strong>{money(data.stats.pending_cents)}</strong><span>Excluded from gross income</span></div></div><p>These figures show recorded setup commissions, before your own taxes and expenses. Reversed entries are excluded. Automatic commission calculation and recurring commission records are not enabled yet; a company invitation alone earns no commission.</p><div className="tableWrap"><table><thead><tr><th>Company</th><th>Recorded</th><th>Commission</th><th>Status</th></tr></thead><tbody>{data.commissions.map(c=><tr key={c.id}><td>{c.company_name}</td><td>{date(c.created_at)}</td><td>{money(c.commission_cents)}</td><td>{c.status}</td></tr>)}</tbody></table>{!data.commissions.length&&<p>No commission entries recorded yet.</p>}</div></section>
 <PartnerTransfers/>
 </div></div></main>
}
