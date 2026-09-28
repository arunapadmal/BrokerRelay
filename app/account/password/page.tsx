'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('Checking your account…')
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setReady(Boolean(data.user))
      setMessage(data.user ? '' : 'Sign in through your invitation or BrokerDesk account before changing your password.')
    })
  }, [])
  async function update(event: FormEvent) {
    event.preventDefault()
    if (password.length < 10) { setMessage('Use at least 10 characters.'); return }
    if (password !== confirm) { setMessage('New passwords do not match.'); return }
    setBusy(true); setMessage('')
    const { error } = await supabase.auth.updateUser({ password, current_password: currentPassword })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    setCurrentPassword(''); setPassword(''); setConfirm('')
    setMessage('Password changed successfully.')
  }
  return <main className="center"><section className="card narrow" aria-labelledby="password-title">
    <BrokerRelayBrand compact />
    <h1 id="password-title">Change password</h1>
    <p className="muted">Enter your current password to protect your account.</p>
    {ready && <form onSubmit={update}>
      <label htmlFor="current-password">Current password</label><input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required />
      <label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={event => setPassword(event.target.value)} required />
      <label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={10} value={confirm} onChange={event => setConfirm(event.target.value)} required />
      <button disabled={busy}>{busy ? 'Updating…' : 'Change password'}</button>
    </form>}
    {message && <p className="notice" role="status">{message}</p>}
    <p className="muted">Forgot your current password? Use <Link href="/login">Forgot password on the sign-in page</Link> or the reset link on your client invitation.</p>
  </section></main>
}
