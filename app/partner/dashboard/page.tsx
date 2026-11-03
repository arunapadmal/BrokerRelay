'use client'
import { PartnerCommissions } from '@/components/PartnerCommissions'
import { InvoiceFinancialResults } from '@/components/InvoiceFinancialResults'

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
 const [data,setData]=useState<Dashboard|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[filter,setFilter]=useState('all'),[tab,setTab]=useState('overview'),[list,setList]=useState('companies'),[search,setSearch]=useState(''),[page,setPage]=useState(1),[incomePage,setIncomePage]=useState(1)
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
 const query=search.trim().toLowerCase()
 const matches=(...values:(string|null)[])=>values.some(v=>v?.toLowerCase().includes(query))
 const invitations=data.invitations.filter(i=>(filter==='all'||i.status===filter)&&matches(i.company_name,i.head_name,i.head_email))
 const companies=data.companies.filter(c=>matches(c.name))
 const count=list==='companies'?companies.length:invitations.length,totalPages=Math.max(1,Math.ceil(count/10)),currentPage=Math.min(page,totalPages)
 const shown=invitations.slice((currentPage-1)*10,currentPage*10)
 const shownCompanies=companies.slice((currentPage-1)*10,currentPage*10)
 const incomePages=Math.max(1,Math.ceil(data.commissions.length/10)),currentIncomePage=Math.min(incomePage,incomePages)
 const pager=<div className="partnerPager"><span>{count?`${(currentPage-1)*10+1}–${Math.min(currentPage*10,count)} of ${count}`:'0 records'}</span><button className="secondary" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Previous</button><span>Page {currentPage} of {totalPages}</span><button className="secondary" disabled={currentPage===totalPages} onClick={()=>setPage(currentPage+1)}>Next</button></div>
 return <main className="platformShell partnerDashboard"><header className="platformHeader"><BrokerRelayBrand compact/><details className="platformAccount"><summary aria-label={'My account: '+data.partner.name}><span className="platformAvatar" aria-hidden="true">{data.partner.name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'P'}</span><span className="partnerAccountIdentity"><strong>{data.partner.name}</strong><small>{data.partner.is_referrer?'Referral partner':'Account manager'}</small></span><span className="platformChevron" aria-hidden="true">⌄</span></summary><div className="platformAccountMenu"><Link href="/partner/dashboard">Partner dashboard</Link><Link href="/account/password">Change password</Link><Link href="/partner/accept">My agreement &amp; privacy</Link><button onClick={()=>void signOut()}>Sign out</button></div></details></header><div className="platformBody">
 <nav className="partnerNav" aria-label="Partner navigation">{[['overview','Dashboard'],['commissions','Commissions'],['transfers','Transfers']].map(([key,label])=><button type="button" key={key} aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)}>{label}</button>)}</nav>
 <div className="platformMain"><div className="platformHeading"><div><p className="eyebrow">REFERRAL PARTNER</p><h1>Welcome, {data.partner.name}</h1><p>{data.partner.partner_code} · <strong>{data.partner.status}</strong></p></div><button type="button" className="secondary" disabled={busy} onClick={()=>void load()}>Refresh</button></div>
 {error&&<p className="notice error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 {!data.can_invite&&<p className="notice">{!data.partner.accepted?<>Accept your current <Link href="/partner/accept">partner agreement</Link> first.</>:data.partner.status!=='active'?'Your agreement is accepted. Company invitations become available after the platform owner activates your referral-partner account. Suspended or closed accounts cannot send invitations.':!data.partner.is_referrer?'Your account-manager role does not include sending referrals. Contact the owner to request the referral role.':'Your offer is not effective yet. Invitations become available from its effective date.'}</p>}
 <section className="billingStats partnerSummary" aria-label="Partner summary"><div><small>Referred companies</small><strong>{data.companies.length}</strong><span>Companies attributed to you</span></div><div><small>Pending invitations</small><strong>{data.stats.pending}</strong><span>{data.stats.accepted} accepted · {data.stats.expired} expired</span></div><div><small>Commission awaiting approval</small><strong>{money(data.stats.pending_cents)}</strong><span>Excluded from approved income</span></div><div><small>Paid commission</small><strong>{money(data.stats.paid_cents)}</strong><span>Approved + paid: {money(data.stats.gross_income_cents)}</span></div></section>
 {tab==='overview'&&<div className="partnerOverviewGrid">
 <section id="invite-company" className="card billingPanel"><h2>Invite a company</h2><p>Invite the Head Broker with their permission. The referral will be recorded under <strong>{data.partner.name}</strong>.</p><form className="billingForm" onSubmit={invite}><fieldset disabled={busy||!data.can_invite}><legend>Head Broker contact</legend><label>Full name<input name="name" required minLength={2} maxLength={160} autoComplete="name"/></label><label>Email address<input name="email" type="email" required maxLength={320} autoComplete="email"/></label><label>Australian mobile<input name="mobile" type="tel" required placeholder="04xx xxx xxx or +614xx xxx xxx" autoComplete="tel"/></label><label className="check"><input type="checkbox" required/>I have permission to share these contact details and send this company invitation.</label><button disabled={busy||!data.can_invite}>Send company setup invitation</button></fieldset></form></section>
 <section id="my-invitations" className="card billingPanel partnerCompanyPanel"><h2>Companies &amp; invitations</h2><div className="partnerListTabs" role="group" aria-label="Company list"><button className="secondary" aria-pressed={list==='companies'} onClick={()=>{setList('companies');setPage(1)}}>Companies ({data.companies.length})</button><button className="secondary" aria-pressed={list==='invitations'} onClick={()=>{setList('invitations');setPage(1)}}>Invitations ({data.stats.invited})</button></div><div className="partnerFilters"><label>Search<input type="search" value={search} placeholder={list==='companies'?'Search company name':'Company, Head Broker or email'} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label>{list==='invitations'&&<label>Status<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(1)}}><option value="all">All invitations</option><option value="pending">Pending</option><option value="accepted">Accepted</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select></label>}</div>{list==='companies'?<><div className="tableWrap"><table><thead><tr><th>Company</th><th>Referred</th></tr></thead><tbody>{shownCompanies.map(c=><tr key={c.id}><td><strong>{c.name}</strong></td><td>{date(c.referred_at)}</td></tr>)}</tbody></table>{!shownCompanies.length&&<p>No companies match this view.</p>}</div><p className="muted">Includes companies attributed to you by the platform owner.</p></>:<><div className="tableWrap"><table><thead><tr><th>Head Broker / company</th><th>Email</th><th>Invited</th><th>Status</th><th>Action</th></tr></thead><tbody>{shown.map(i=><tr key={i.id}><td><strong>{i.company_name||i.head_name}</strong>{i.company_name&&<><br/>{i.head_name}</>}</td><td>{i.head_email}{i.simulated&&<small className="blockText">Demo · simulated</small>}</td><td>{date(i.created_at)}</td><td><span className={'partnerStatus '+i.status}>{i.status}</span><br/><small>{i.status==='accepted'&&i.completed_at?'Completed '+date(i.completed_at):i.status==='pending'?'Expires '+date(i.expires_at):''}</small></td><td>{!i.simulated&&['pending','expired'].includes(i.status)&&<button className="secondary" disabled={busy||!data.can_invite} onClick={()=>void resend(i)}>Resend invitation</button>}</td></tr>)}</tbody></table>{!shown.length&&<p>No invitations in this view.</p>}</div><p className="muted">Accepted means setup is complete. Pending does not confirm email delivery. Demo records do not imply email delivery or legal acceptance.</p></>}{pager}</section></div>}
 {tab==='commissions'&&<><PartnerCommissions/><details className="card billingPanel"><summary>Historical setup commission records</summary>
 <section id="my-income" className="card billingPanel"><h2>Commission income</h2><div className="billingStats"><div><small>Gross recorded income</small><strong>{money(data.stats.gross_income_cents)}</strong><span>Approved and paid entries</span></div><div><small>Paid</small><strong>{money(data.stats.paid_cents)}</strong><span>Included in gross income above</span></div><div><small>Awaiting approval</small><strong>{money(data.stats.pending_cents)}</strong><span>Excluded from gross income</span></div></div><p>These figures show recorded setup commissions, before your own taxes and expenses. Reversed entries are excluded. The collected-fee ledger above tracks newly activated offers. These historical setup records remain separate; a company invitation alone earns no commission.</p><div className="tableWrap"><table><thead><tr><th>Company</th><th>Recorded</th><th>Commission</th><th>Status</th></tr></thead><tbody>{data.commissions.slice((currentIncomePage-1)*10,currentIncomePage*10).map(c=><tr key={c.id}><td>{c.company_name}</td><td>{date(c.created_at)}</td><td>{money(c.commission_cents)}</td><td>{c.status}</td></tr>)}</tbody></table>{!data.commissions.length&&<p>No commission entries recorded yet.</p>}</div><div className="partnerPager"><button className="secondary" disabled={currentIncomePage===1} onClick={()=>setIncomePage(currentIncomePage-1)}>Previous</button><span>Page {currentIncomePage} of {incomePages}</span><button className="secondary" disabled={currentIncomePage===incomePages} onClick={()=>setIncomePage(currentIncomePage+1)}>Next</button></div></section></details><details className="card billingPanel"><summary>Earlier development tests</summary><InvoiceFinancialResults partner/></details></>}
 {tab==='transfers'&&<PartnerTransfers/>}
 </div></div></main>
}
