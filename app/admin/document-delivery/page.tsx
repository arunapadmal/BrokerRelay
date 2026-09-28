'use client'

import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'

type Access = { organisation_id?: string; organisation_name?: string; is_head_broker?: boolean }
type Endpoint = { email: string; verified: boolean; pending: boolean }

export default function CompanyDocumentDeliveryPage() {
  const [access, setAccess] = useState<Access | null>(null)
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) { window.location.href = '/login'; return }
    const { data, error: accessError } = await supabase.rpc('get_my_portal_access')
    if (accessError) { setError(accessError.message); return }
    const next = (data ?? {}) as Access
    setAccess(next)
    if (!next.is_head_broker || !next.organisation_id) return
    const { data: rows, error: statusError } = await supabase.rpc('get_company_document_email_status', {
      p_organisation_id: next.organisation_id,
    })
    if (statusError) { setError(statusError.message); return }
    setEndpoints((rows ?? []) as Endpoint[])
    const pending = (rows ?? []).find((row: Endpoint) => row.pending)
    if (pending) setEmail(pending.email)
  }

  useEffect(() => { void load() }, [])

  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!access?.organisation_id || busy) return
    setBusy(true); setError(''); setNotice('')
    const { error: proposeError } = await supabase.rpc('propose_company_document_email', {
      p_organisation_id: access.organisation_id, p_email: email.trim(),
    })
    setBusy(false)
    if (proposeError) { setError(proposeError.message); return }
    setCode('')
    setNotice('Address saved as pending. Send a verification code to its mailbox.')
    await load()
  }

  async function sendCode() {
    if (!access?.organisation_id || busy) return
    setBusy(true); setError(''); setNotice('')
    const { data, error: sendError } = await supabase.functions.invoke('send-company-document-code', {
      body: { organisation_id: access.organisation_id },
    })
    setBusy(false)
    if (sendError || data?.error) {
      setError(data?.error ?? sendError?.message ?? 'Verification email could not be sent.')
      return
    }
    setNotice(`Verification code sent to ${email}. Enter it below within 15 minutes.`)
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!access?.organisation_id || busy) return
    setBusy(true); setError(''); setNotice('')
    const { data: valid, error: confirmError } = await supabase.rpc('confirm_company_document_email', {
      p_organisation_id: access.organisation_id, p_code: code.trim(),
    })
    setBusy(false)
    if (confirmError || !valid) {
      setError(confirmError?.message ?? 'Code is invalid, expired, or has been tried too many times.')
      return
    }
    setCode('')
    setNotice('Document delivery email verified. Assigned brokers can now request documents.')
    await load()
  }

  return <ApplicationWorkspaceShell section="delivery">
    <header className="applicationHeader"><div>
      <p className="eyebrow">COMPANY DOCUMENT DELIVERY</p>
      <h1>Document delivery settings</h1>
      <p className="muted">{access?.organisation_name ?? 'Your company'} · Verify the email address that receives client documents.</p>
    </div></header>
    <section className="card deliverySettingsCard">
      {!access && !error && <p>Loading company access…</p>}
      {access && !access.is_head_broker && <p>Only your company’s Head Broker can verify its document delivery mailbox.</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      {access?.is_head_broker && <>
        <p>BrokerRelay sends uploaded documents to this verified company mailbox and privately copies the broker who requested them at their confirmed sign-in email, while that broker remains active in the company. To copy additional people, configure forwarding with your email provider. Open requests keep the company delivery destination recorded when they were created.</p>
        <div className="deliveryEndpointList" aria-label="Document delivery addresses">
          {endpoints.length === 0 ? <p className="muted">No delivery address configured yet.</p> : endpoints.map((endpoint, index) => <div className="deliveryEndpointRow" key={`${endpoint.email}-${index}`}>
            <span className={endpoint.verified ? 'pill' : 'systemOfRecord'}>{endpoint.verified ? 'Verified' : 'Pending'}</span>
            <strong>{endpoint.email}</strong>
          </div>)}
        </div>
        <form className="applicationForm" onSubmit={propose}>
          <label>Company document delivery email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="documents@yourcompany.com.au" required /></label>
          <div><button disabled={busy}>{busy ? 'Saving…' : 'Save address for verification'}</button></div>
        </form>
      </>}
    </section>
    {access?.is_head_broker && endpoints.some(e => e.pending) && <section className="card deliverySettingsCard">
      <p className="eyebrow">VERIFY THE MAILBOX</p><h2>Confirm delivery address</h2>
      <p className="muted">Send an eight-digit code to the pending mailbox. The code expires after 15 minutes.</p>
      <button className="secondary" type="button" disabled={busy} onClick={sendCode}>Send verification code</button>
      <form className="applicationForm" onSubmit={confirm}>
        <label>Eight-digit code from the mailbox<input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" required /></label>
        <div><button disabled={busy}>{busy ? 'Verifying…' : 'Verify mailbox'}</button></div>
      </form>
    </section>}
  </ApplicationWorkspaceShell>
}
