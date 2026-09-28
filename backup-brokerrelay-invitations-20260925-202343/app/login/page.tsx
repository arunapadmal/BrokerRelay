'use client'

import { FormEvent, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('aruna@aidez.com.au')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function forgotPassword() {
    if (!email) { setMessage('Enter your email address first.'); return }
    setBusy(true); setMessage('')
    const redirectTo = `${window.location.origin}/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    setBusy(false)
    setMessage(error ? error.message : 'Password reset email sent. Open it and create a new password.')
  }

  async function login(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) {
      setMessage(error.message)
      return
    }
    window.location.href = '/dashboard'
  }

  return (
    <main className="center">
      <div className="card narrow">
        <div className="brand">AIDEZ</div>
        <h1>BrokerDesk</h1>
        <p className="muted">Development login</p>
        <form onSubmit={login}>
          <label>Email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" required />
          <label>Password</label>
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" required />
          <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <button type="button" className="secondary" disabled={busy} onClick={forgotPassword}>Forgot password?</button>
        {message && <p className="error">{message}</p>}
      </div>
    </main>
  )
}
