'use client'

import { FormEvent, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function forgotPassword() {
    if (!email.trim()) { setMessage('Enter your email address first, then select Forgot password.'); return }
    setBusy(true); setMessage('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setBusy(false)
    setMessage(error ? error.message : 'If this email has an account, a password reset link will arrive shortly.')
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    window.location.href = '/dashboard'
  }

  return <main className="brokerRelayLoginPage">
    <div className="brokerRelayLoginBackdrop" aria-hidden="true" />
    <section className="brokerRelayLoginCard" aria-labelledby="login-title">
      <div className="brokerRelayLoginIdentity"><BrokerRelayBrand /></div>
      <h1 id="login-title">Welcome back</h1>
      <p className="brokerRelayLoginIntro">Sign in to your account</p>
      <form onSubmit={login}>
        <label className="brokerRelayFieldLabel" htmlFor="brokerrelay-email">Email address</label>
        <div className="brokerRelayInputWrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>
          <input id="brokerrelay-email" value={email} onChange={event => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="Email address" required />
        </div>
        <label className="brokerRelayFieldLabel" htmlFor="brokerrelay-password">Password</label>
        <div className="brokerRelayInputWrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
          <input id="brokerrelay-password" value={password} onChange={event => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Password" required />
          <button type="button" className="brokerRelayVisibility" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>
          </button>
        </div>
        <div className="brokerRelayLoginActions">
          <button type="button" className="brokerRelayForgot" disabled={busy} onClick={forgotPassword}>Forgot password?</button>
        </div>
        <button className="brokerRelaySignIn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {message && <p className="brokerRelayLoginMessage" role="status">{message}</p>}
    </section>
  </main>
}
