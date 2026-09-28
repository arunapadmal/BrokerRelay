'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'

type Company = { id: string; name: string; legal_name: string | null; abn: string | null; status: string }
type Invitation = { id: string; head_name: string; head_email: string; head_mobile: string; status: string; created_at: string; expires_at: string }

export default function PlatformCompaniesPage() {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function load() {
    const [companyResult, invitationResult] = await Promise.all([
      supabase.rpc('platform_list_companies'),
      supabase.rpc('platform_list_company_invitations'),
    ])
    setError('')
    if (companyResult.error) setError(`Could not load companies: ${companyResult.error.message}`)
    else setCompanies((companyResult.data ?? []) as Company[])
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
      if (!owner || auth.user.email?.toLowerCase() !== 'aruna@aidez.com.au') {
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
    const { error: createError } = await supabase.rpc('platform_invite_company', {
      p_name: String(fields.get('name') ?? ''), p_email: email, p_mobile: String(fields.get('mobile') ?? ''),
    })
    if (createError) { setError(createError.message); setBusy(false); return }
    const { error: emailError } = await supabase.auth.signInWithOtp({
      email, options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/platform/company-setup` },
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
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/platform/company-setup` },
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

  if (!ready) return <main className="page"><p>Checking platform access…</p></main>
  return <main className="platformShell">
    <header className="platformHeader">
      <BrokerRelayBrand compact />
      <details className="platformAccount"><summary><span className="platformAvatar" aria-hidden="true">A</span><span><strong>Aruna Weerakkody</strong><small>Platform Owner</small></span><span className="platformChevron" aria-hidden="true">⌄</span></summary><div className="platformAccountMenu"><Link href="/dashboard">Broker Desk</Link><button type="button" onClick={signOut}>Sign out</button></div></details>
    </header>
    <div className="platformBody">
      <nav className="platformSidebar" aria-label="Platform navigation">
        <a className="platformNavActive" href="#companies"><span aria-hidden="true">▦</span> Companies</a>
        <a href="#invitations"><span aria-hidden="true">✉</span> Invitations</a>
        <div className="platformSidebarBottom"><Link href="/dashboard"><span aria-hidden="true">⌂</span> Broker Desk</Link></div>
      </nav>
      <div className="platformMain">
        <section id="companies" className="platformCompanies">
          <div className="platformHeading"><div><h1>Companies</h1><p>Independent companies using BrokerRelay. Each company manages its own staff, clients and data.</p></div></div>
          <div className="tableWrap"><table><thead><tr><th>Trading name</th><th>Legal name</th><th>ABN</th><th>Status</th></tr></thead>
            <tbody>{companies.map(company => <tr key={company.id}><td><strong>{company.name}</strong></td><td>{company.legal_name ?? '—'}</td><td>{company.abn ?? '—'}</td><td><span className={`platformStatus ${company.status === 'active' ? 'isActive' : ''}`}>{company.status}</span></td></tr>)}</tbody></table></div>
          {!companies.length && <p className="platformEmpty">No companies yet. Send a setup invitation to add the first company.</p>}
        </section>
        <section id="invitations" className="platformInvitationCard">
          <div className="platformInvitationIntro"><span className="platformInvitationIcon" aria-hidden="true">➤</span><div><h2>Send company setup invitation</h2><p>Invite a Head Broker to register a new company on BrokerRelay. The Head Broker will create their account and complete the company setup.</p><p className="platformExpiry">Invitations expire after seven days.</p></div></div>
          <div className="platformInvitationForm">
            {error && <div className="notice error" role="alert">{error}</div>}
            {success && <div className="notice" role="status">{success}</div>}
            <form onSubmit={sendInvitation}>
              <label>Head Broker full name<input name="name" placeholder="e.g. John Smith" maxLength={160} autoComplete="name" required /></label>
              <label>Head Broker email address<input name="email" placeholder="e.g. gayathri@xyz.com.au" type="email" autoComplete="email" required /></label>
              <label>Head Broker mobile number<input name="mobile" placeholder="e.g. 0412 345 678" type="tel" autoComplete="tel" required /></label>
              <button className="platformSubmit" disabled={busy}>{busy ? 'Sending…' : '➤  Send invitation'}</button>
            </form>
          </div>
        </section>
        <section className="platformHistory" aria-label="Invitation history"><h2>Invitation history</h2>
          <div className="tableWrap"><table><thead><tr><th>Head Broker</th><th>Email</th><th>Mobile</th><th>Status</th><th>Sent</th><th>Action</th></tr></thead>
            <tbody>{invitations.map(invitation => <tr key={invitation.id}>
              <td>{invitation.head_name}</td><td>{invitation.head_email}</td><td>{invitation.head_mobile}</td>
              <td>{invitation.status === 'pending' && new Date(invitation.expires_at) <= new Date() ? 'Expired' : invitation.status}</td>
              <td>{new Date(invitation.created_at).toLocaleDateString('en-AU')}</td>
              <td>{invitation.status === 'pending' && <div className="row">
                {new Date(invitation.expires_at) > new Date() && <button type="button" className="secondary small" onClick={() => void resend(invitation)}>Resend</button>}
                <button type="button" className="secondary small" onClick={() => void cancel(invitation.id)}>Cancel</button>
              </div>}</td>
            </tr>)}</tbody></table></div>
          {!invitations.length && <p className="platformEmpty">No invitations yet.</p>}
        </section>
      </div>
    </div>
  </main>
}
