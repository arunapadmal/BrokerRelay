'use client'
import { usePathname } from 'next/navigation'
import { InvitationHistory } from '@/components/InvitationHistory'
import { PlatformNavigation } from '@/components/PlatformNavigation'
import { PLATFORM_OWNER_EMAIL } from '@/lib/platform-owner'

import Link from 'next/link'
import { Fragment, FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Performance } from '@/components/CompanyPerformance'
import { companySetupUrl } from '@/lib/company-invitation-url'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'
import { CompanyBillingPanel } from '@/components/CompanyBillingPanel'
import { CompanyLogoEditor } from '@/components/CompanyLogoEditor'

type Company = { id: string; name: string; legal_name: string | null; abn: string | null; status: string; created_at: string; billing_email: string | null; contact_phone: string | null; website: string | null; head_broker_name: string | null; head_broker_mobile: string | null; head_broker_email: string | null; logo_url: string | null; logo_display_width: number; logo_display_height: number }
type ReferralNames = { referrer: string; manager: string }
type Invitation = { id: string; head_name: string; head_email: string; head_mobile: string; status: string; created_at: string; expires_at: string }

export default function PlatformCompaniesPage() {
 const view=usePathname().split('/')[3]||'list'
 const [page,setPage]=useState(1),[invitationPage,setInvitationPage]=useState(1)
  const [referrers,setReferrers]=useState<{id:string;display_name:string}[]>([])
  const [referralNames,setReferralNames]=useState<Record<string,ReferralNames>>({})
  const [period,setPeriod]=useState('all')
  const [monthly,setMonthly]=useState<Record<string,Performance>>({})
  const [performance,setPerformance] = useState<Record<string,Performance>>({})
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [companySearch, setCompanySearch] = useState('')
  const [companies, setCompanies] = useState<Company[]>([])
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const shownPerformance=period==='month'?monthly:performance
  async function load() {
    const [companyResult, invitationResult, logoResult] = await Promise.all([
      supabase.rpc('platform_company_contact_overview_v2'),
      supabase.rpc('platform_list_company_invitations'),
      supabase.from('organisations').select('id,logo_url,logo_display_width,logo_display_height'),
    ])
    const partners=await supabase.rpc('m7_admin_partner_dashboard')
    if(partners.error){setError(partners.error.message);return}
    setReferrers((partners.data?.partners??[]).filter((p:{status:string;is_referrer:boolean})=>p.status==='active'&&p.is_referrer))
    const partnerNames = new Map<string,string>((partners.data?.partners??[]).map((p:{id:string;display_name:string})=>[p.id,p.display_name]))
    setReferralNames(Object.fromEntries((partners.data?.referrals??[]).map((r:{organisation_id:string;referring_partner_id:string|null;assigned_account_manager_id:string|null})=>[r.organisation_id,{referrer:r.referring_partner_id?(partnerNames.get(r.referring_partner_id)??'Partner unavailable'):'Direct / no referrer',manager:r.assigned_account_manager_id?(partnerNames.get(r.assigned_account_manager_id)??'Partner unavailable'):'Not assigned'}])))
    const stats=await supabase.rpc('company_performance')
    setPerformance(Object.fromEntries((stats.data??[]).map((r:Performance)=>[r.organisation_id,r])))
    const monthStats=await supabase.rpc('company_performance_month')
    setMonthly(Object.fromEntries((monthStats.data??[]).map((r:Performance)=>[r.organisation_id,r])))
    setError(stats.error?'Company counts unavailable. Apply the company performance SQL update.':'')
    if (companyResult.error) setError(`Could not load companies: ${companyResult.error.code === 'PGRST202' ? 'Apply the platform_company_contact_email migration, then refresh this page.' : companyResult.error.message}`)
    else {
      const logos = new Map((logoResult.data ?? []).map(row => [row.id, row]))
      setCompanies(((companyResult.data ?? []) as Company[]).map(row => ({ ...row, logo_url: logos.get(row.id)?.logo_url ?? null, logo_display_width: logos.get(row.id)?.logo_display_width ?? 160, logo_display_height: logos.get(row.id)?.logo_display_height ?? 72 })))
    }
    if (logoResult.error) setError(`Could not load company logos: ${logoResult.error.message}`)
    if (invitationResult.error) {
      const missingMigration = invitationResult.error.code === 'PGRST202'
      setError(missingMigration
        ? 'Company invitations are not ready in this Supabase project. Apply the company_setup_invitations migration, then refresh this page.'
        : `Could not load invitations: ${invitationResult.error.message}`)
    } else setInvitations((invitationResult.data ?? []) as Invitation[])
  }

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) { window.location.href = '/login'; return }
      const { data: owner } = await supabase.from('platform_admins').select('user_id').eq('user_id', auth.user.id).maybeSingle()
      if (!owner || auth.user.email?.toLowerCase() !== PLATFORM_OWNER_EMAIL) {
        window.location.href = '/dashboard'; return
      }
      await load(); setReady(true)
    })()
  }, [])

  async function sendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const fields = new FormData(form)
    const email = String(fields.get('email') ?? '').trim().toLowerCase()
    setBusy(true); setError(''); setSuccess('')
    const { error: createError } = await supabase.rpc('platform_invite_company_with_referrer', {
      p_name: String(fields.get('name') ?? ''), p_email: email, p_mobile: String(fields.get('mobile') ?? ''), p_referring_partner_id: String(fields.get('referrer')??'')||null,
    })
    if (createError) { setError(createError.message); setBusy(false); return }
    const { error: emailError } = await supabase.auth.signInWithOtp({
      email, options: { shouldCreateUser: true, emailRedirectTo: companySetupUrl() },
    })
    setBusy(false)
    if (emailError) setError(`Invitation saved, but the email was not sent: ${emailError.message}. Use Resend after checking email delivery.`)
    else { form.reset(); setSuccess(`Company setup invitation sent to ${email}.`) }
    await load()
  }

  async function resend(invitation: Invitation) {
    setError(''); setSuccess('')
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: invitation.head_email,
      options: { shouldCreateUser: true, emailRedirectTo: companySetupUrl() },
    })
    if (sendError) setError(sendError.message)
    else setSuccess(`Invitation email sent to ${invitation.head_email}.`)
  }

  async function cancel(id: string) {
    setError(''); setSuccess('')
    const { error: cancelError } = await supabase.rpc('platform_cancel_company_invitation', { p_id: id })
    if (cancelError) setError(cancelError.message)
    else { setSuccess('Invitation cancelled.'); await load() }
  }

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) { setError(`Could not sign out: ${signOutError.message}`); return }
    window.location.href = '/login'
  }

  const searchText = companySearch.trim().toLocaleLowerCase()
  const visibleCompanies = companies.filter(company =>
    !searchText || [company.name, company.head_broker_name, company.head_broker_email, referralNames[company.id]?.referrer, referralNames[company.id]?.manager]
      .some(value => value?.toLocaleLowerCase().includes(searchText))
  )

  if (!ready) return <main className="page"><p>Checking platform access…</p></main>
  return <main className="platformShell">
    <header className="platformHeader">
      <BrokerRelayBrand compact />
      <details className="platformAccount"><summary><span className="platformAvatar" aria-hidden="true">A</span><span><strong>Platform Owner</strong><small>Platform Owner</small></span><span className="platformChevron" aria-hidden="true">⌄</span></summary><div className="platformAccountMenu"><Link href="/platform/dashboard">Platform dashboard</Link><button type="button" onClick={signOut}>Sign out</button></div></details>
    </header>
    <div className="platformBody">
      <PlatformNavigation />
      <div className="platformMain">{error&&<p className="notice error" role="alert">{error}</p>}
        {view==='list'&&<section id="companies" className="platformCompanies">
          <div className="platformHeading"><div><h1>Companies</h1><p>Independent companies using BrokerRelay. Each company manages its own staff, clients and data.</p></div></div>
          <div className="row" role="group" aria-label="Company reporting period"><button type="button" className={period==='all'?'':'secondary'} aria-pressed={period==='all'} onClick={()=>setPeriod('all')}>All time</button><button type="button" className={period==='month'?'':'secondary'} aria-pressed={period==='month'} onClick={()=>setPeriod('month')}>This month</button></div><p className="muted">{period==='month'?'New clients and applications created this month; settlements use the actual settlement date in Melbourne time. Missing counts require the monthly performance SQL update.':'All-time records by current status.'}</p>
          <label className="platformSearchLabel" htmlFor="company-search">Search companies</label>
          <input id="company-search" className="platformSearch" type="search" value={companySearch} onChange={event => {setCompanySearch(event.target.value);setPage(1)}} placeholder="Company, Head Broker, or email" />
          <div className="tableWrap"><table><thead><tr><th>Company</th><th>Referral partner</th><th>Head Broker</th><th>Contact number</th><th>Status</th><th>{period==='month'?'New clients':'Clients'}</th><th>{period==='month'?'New applications':'Applications'}</th></tr></thead>
            <tbody>{visibleCompanies.slice((Math.min(page,Math.max(1,Math.ceil(visibleCompanies.length/10)))-1)*10,Math.min(page,Math.max(1,Math.ceil(visibleCompanies.length/10)))*10).map(company => <Fragment key={company.id}><tr><td><Link className="platformCompanyToggle" href={`/platform/companies/${company.id}`}>{company.name} →</Link></td><td>{referralNames[company.id]?.referrer??'Direct / no referrer'}<small style={{display:'block'}}>Account manager: {referralNames[company.id]?.manager??'Not assigned'}</small></td><td>{company.head_broker_name ?? '—'}</td><td>{company.head_broker_mobile ? <a href={`tel:${company.head_broker_mobile.replace(/[^+\d]/g, '')}`}>{company.head_broker_mobile}</a> : '—'}</td><td><span className={`platformStatus ${company.status === 'active' ? 'isActive' : ''}`}>{company.status}</span></td><td>{shownPerformance[company.id]?.clients ?? '—'}</td><td>{shownPerformance[company.id]?.applications ?? '—'}{shownPerformance[company.id] && <small style={{display:'block'}}>{period==='month'?`Settlements this month: ${shownPerformance[company.id].settled_month??0}`:`Settled: ${shownPerformance[company.id].application_statuses.settled??0} · Withdrawn: ${shownPerformance[company.id].application_statuses.withdrawn??0}`}</small>}</td></tr>

            </Fragment>)}</tbody></table></div>
          {!companies.length ? <p className="platformEmpty">No companies yet. Send a setup invitation to add the first company.</p> : visibleCompanies.length === 0 && <p className="platformEmpty">No companies match your search.</p>}
        <div className="workspacePager"><span>{visibleCompanies.length} companies · Page {Math.min(page,Math.max(1,Math.ceil(visibleCompanies.length/10)))} of {Math.max(1,Math.ceil(visibleCompanies.length/10))}</span><button className="secondary" disabled={page<=1} onClick={()=>setPage(page-1)}>Previous</button><button className="secondary" disabled={page>=Math.ceil(visibleCompanies.length/10)} onClick={()=>setPage(page+1)}>Next</button></div></section>}
        {view==='invitations'&&<><section id="invitations" className="platformInvitationCard">
          <div className="platformInvitationIntro"><span className="platformInvitationIcon" aria-hidden="true">➤</span><div><h2>Send company setup invitation</h2><p>Invite a Head Broker to register a new company on BrokerRelay. The Head Broker will create their account and complete the company setup.</p><p className="platformExpiry">Invitations expire after seven days.</p></div></div>
          <div className="platformInvitationForm">
            {error && <div className="notice error" role="alert">{error}</div>}
            {success && <div className="notice" role="status">{success}</div>}
            <form onSubmit={sendInvitation}>
              <label>Head Broker full name<input name="name" placeholder="e.g. John Smith" maxLength={160} autoComplete="name" required /></label>
              <label>Head Broker email address<input name="email" placeholder="e.g. john.smith@example.com" type="email" autoComplete="email" required /></label>
              <label>Head Broker mobile number<input name="mobile" placeholder="e.g. 0412 345 678" type="tel" autoComplete="tel" required /></label>
              <label>Original referral partner (optional)<select name="referrer"><option value="">Direct signup / no referrer</option>{referrers.map(p=><option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
              <button className="platformSubmit" disabled={busy}>{busy ? 'Sending…' : '➤  Send invitation'}</button>
            </form>
          </div>
        </section>
        <details open className="platformHistory"><summary>Manage actual invitations · resend or cancel</summary><h2>Actual invitation history</h2>
          <div className="tableWrap"><table><thead><tr><th>Head Broker</th><th>Email</th><th>Mobile</th><th>Status</th><th>Sent</th><th>Action</th></tr></thead>
            <tbody>{invitations.slice((invitationPage-1)*10,invitationPage*10).map(invitation => <tr key={invitation.id}>
              <td>{invitation.head_name}</td><td>{invitation.head_email}</td><td>{invitation.head_mobile}</td>
              <td>{invitation.status === 'pending' && new Date(invitation.expires_at) <= new Date() ? 'Expired' : invitation.status}</td>
              <td>{new Date(invitation.created_at).toLocaleDateString('en-AU')}</td>
              <td>{invitation.status === 'pending' && <div className="row">
                {new Date(invitation.expires_at) > new Date() && <button type="button" className="secondary small" onClick={() => void resend(invitation)}>Resend</button>}
                <button type="button" className="secondary small" onClick={() => void cancel(invitation.id)}>Cancel</button>
              </div>}</td>
            </tr>)}</tbody></table></div>
          {!invitations.length && <p className="platformEmpty">No invitations yet.</p>}
        <div className="workspacePager"><span>{invitations.length} invitations · Page {invitationPage}</span><button className="secondary" disabled={invitationPage<=1} onClick={()=>setInvitationPage(invitationPage-1)}>Previous</button><button className="secondary" disabled={invitationPage*10>=invitations.length} onClick={()=>setInvitationPage(invitationPage+1)}>Next</button></div></details>
        </>}{view==='onboarding'&&<InvitationHistory/>}
      </div>
    </div>
  </main>
}
