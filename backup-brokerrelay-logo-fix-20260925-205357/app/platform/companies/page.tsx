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
      supabase.from('organisations').select('id,name,legal_name,abn,status').order('created_at'),
      supabase.rpc('platform_list_company_invitations'),
    ])
    if (companyResult.error || invitationResult.error) {
      setError(companyResult.error?.message ?? invitationResult.error?.message ?? 'Could not load companies.')
      return
    }
    setCompanies((companyResult.data ?? []) as Company[])
    setInvitations((invitationResult.data ?? []) as Invitation[])
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

  if (!ready) return <main className="page"><p>Checking platform access…</p></main>
  return <main className="page">
    <header className="topbar"><BrokerRelayBrand compact /><Link className="button secondary small" href="/dashboard">Broker Desk</Link></header>
    <section className="card">
      <p className="eyebrow">PLATFORM OWNER</p><h1>Companies</h1>
      <p className="muted">Each company has its own Head Broker and workspace.</p>
      <div className="tableWrap"><table><thead><tr><th>Trading name</th><th>Legal name</th><th>ABN</th><th>Status</th></tr></thead>
        <tbody>{companies.map(company => <tr key={company.id}><td>{company.name}</td><td>{company.legal_name ?? '—'}</td><td>{company.abn ?? '—'}</td><td>{company.status}</td></tr>)}</tbody></table></div>
      {!companies.length && <p className="muted">No companies yet.</p>}
    </section>
    <section className="card" style={{maxWidth:900,margin:'24px auto'}}>
      <p className="eyebrow">INVITE NEW COMPANY</p><h2>Send company setup invitation</h2>
      <p className="muted">The Head Broker will create a password and enter the company details. Invitations expire after seven days.</p>
      {error && <div className="notice error" role="alert">{error}</div>}
      {success && <div className="notice" role="status">{success}</div>}
      <form onSubmit={sendInvitation}>
        <label>Head Broker full name<input name="name" maxLength={160} required /></label>
        <div className="formGrid"><label>Head Broker email<input name="email" type="email" required /></label>
          <label>Head Broker mobile<input name="mobile" type="tel" autoComplete="tel" required /></label></div>
        <button disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button>
      </form>
    </section>
    <section className="card"><h2>Invitations</h2>
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
      {!invitations.length && <p className="muted">No invitations yet.</p>}
    </section>
  </main>
}
