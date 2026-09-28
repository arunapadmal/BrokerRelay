'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('Checking reset link…')
  const [updated, setUpdated] = useState(false)
  const [returnToInvite, setReturnToInvite] = useState('')

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setReady(Boolean(data.session))
      setMessage(data.session ? '' : 'This reset link is invalid or expired. Request a new link from the login page.')
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) { setReady(true); setMessage('') }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function update(event: FormEvent) {
    event.preventDefault()
    if (password.length < 10) { setMessage('Use at least 10 characters.'); return }
    if (password !== confirm) { setMessage('Passwords do not match.'); return }
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setMessage(error.message); return }
    setUpdated(true)
    setReady(false)
    const path = (() => { try { return sessionStorage.getItem('brokerrelay-invitation-return') ?? '' } catch { return '' } })()
    if (/^\/join\/[A-Za-z0-9_-]+$/.test(path)) setReturnToInvite(path)
    setMessage('Password updated. Return to the invitation to connect your client account, or sign in to BrokerDesk if you are staff.')
  }

  return <main className="center"><div className="card narrow"><BrokerRelayBrand compact /><h1>Create a new password</h1><p className="muted">This page completes the password reset; it is not a magic-link login.</p>{ready && <form onSubmit={update}><label>New password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={10} required /><label>Confirm password</label><input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} minLength={10} required /><button>Update password</button></form>}{message && <p role="status">{message}</p>}{updated && <p>{returnToInvite && <Link className="button" href={returnToInvite}>Return to invitation</Link>} <Link className="button secondary" href="/login">BrokerDesk sign in</Link></p>}</div></main>
}
