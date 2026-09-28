'use client'

import Link from 'next/link'
import { SyntheticEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type SecurityAction = {
  id: string; organisation_name: string
  action: 'confirm_current' | 'cancel_current' | 'respond_successor'
  counterparty_name: string; expires_at: string
}

export default function OwnershipTransferPage() {
  const [transferId, setTransferId] = useState('')
  const [action, setAction] = useState<SecurityAction | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) { window.location.href = '/login'; return }
    setEmail(auth.user.email ?? '')
    const { data, error: loadError } = await supabase.rpc('get_my_security_actions')
    if (loadError) { setError(loadError.message); return }
    const found = ((data ?? []) as SecurityAction[]).find(item => item.id === transferId) ?? null
    setAction(found)
    if (!found) setError('This ownership action is unavailable, completed, cancelled, declined, or expired.')
  }

  useEffect(() => { setTransferId(new URLSearchParams(window.location.search).get('id') ?? '') }, [])
  useEffect(() => { if (transferId) void load() }, [transferId])

  async function cancelTransfer() {
    if (!action || !window.confirm('Cancel this ownership handover?')) return
    setBusy(true); setError('')
    const { error: cancelError } = await supabase.rpc('cancel_head_broker_transfer', { p_transfer_id: action.id })
    setBusy(false)
    if (cancelError) { setError(cancelError.message); return }
    setAction(null); setMessage('Ownership handover cancelled. No authority was changed.')
  }

  async function verifyAndRespond(event: SyntheticEvent, response?: boolean) {
    event.preventDefault()
    if (!action) return
    setBusy(true); setError(''); setMessage('')
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password })
    if (verifyError) { setBusy(false); setError(verifyError.message); return }
    const result = action.action === 'confirm_current'
      ? await supabase.rpc('confirm_head_broker_transfer_current', { p_transfer_id: action.id })
      : await supabase.rpc('respond_head_broker_transfer', { p_transfer_id: action.id, p_accept: Boolean(response) })
    setBusy(false)
    if (result.error) { setError(result.error.message); return }
    setAction(null)
    setMessage(action.action === 'confirm_current'
      ? 'Confirmed. The nominated successor now has a dashboard action to accept or decline.'
      : response ? 'Accepted. Head Broker ownership has been transferred.' : 'The ownership handover was declined.')
  }

  return (
    <main className="page">
      <Link className="backLink" href="/dashboard">← BrokerDesk</Link>
      <section className="card" style={{ maxWidth: 760, margin: '48px auto' }}>
        <p className="eyebrow">SECURITY ACTION</p>
        <h1>Head Broker ownership</h1>
        {error && <div className="notice error">{error}</div>}
        {message && <div className="notice success">{message}</div>}
        {action && <>
          <p><strong>{action.organisation_name}</strong></p>
          <p>{action.action === 'confirm_current'
            ? `You proposed transferring Head Broker ownership to ${action.counterparty_name}. Confirming does not transfer it yet; the successor must accept.`
            : action.action === 'cancel_current'
              ? `${action.counterparty_name} can now accept the handover. You may cancel it until they accept.`
              : `${action.counterparty_name} nominated you as the new Head Broker. Accepting makes you the sole Head Broker and changes their roles to the roles chosen in the proposal.`}</p>
          <p className="muted">Expires {new Date(action.expires_at).toLocaleString()}.</p>
          {action.action === 'cancel_current' ? <button className="danger" onClick={cancelTransfer} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel handover'}</button> :
            <form onSubmit={(event) => verifyAndRespond(event, true)}>
              <label>Confirm your password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>
              <div className="row">
                <button disabled={busy || !password}>{busy ? 'Verifying…' : action.action === 'confirm_current' ? 'Verify and confirm' : 'Verify and accept'}</button>
                {action.action === 'respond_successor' && <button type="button" className="danger" disabled={busy || !password} onClick={(event) => void verifyAndRespond(event, false)}>Verify and decline</button>}
              </div>
            </form>}
        </>}
      </section>
    </main>
  )
}
