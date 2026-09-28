'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'

type Preview = {
  expires_at: string
  organisation: { name: string; logo_url?: string | null; website?: string | null }
  broker: {
    first_name: string
    last_name: string
    title: string
    broker_code: string
    contact_email?: string | null
    contact_mobile?: string | null
  }
}

export default function JoinPage() {
  const params = useParams<{ token: string }>()
  const token = decodeURIComponent(params.token)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mode, setMode] = useState<'signup'|'signin'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [mobile, setMobile] = useState('')
  const [message, setMessage] = useState('Loading invitation…')
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needsName, setNeedsName] = useState(false)

  useEffect(() => {
    supabase.functions.invoke('preview-client-invite', { body: { token } })
      .then(({ data, error }) => {
        if (error || data?.error) {
          setMessage(data?.error ?? error?.message ?? 'Invitation unavailable.')
          return
        }
        setPreview(data)
        setMessage('')
      })
  }, [token])

  async function claim(givenFirst = firstName, givenLast = lastName, givenMobile = mobile) {
    const { data, error } = await supabase.functions.invoke('claim-client-invite', {
      body: { token, first_name: givenFirst.trim(), last_name: givenLast.trim(), mobile: givenMobile.trim() }
    })
    if (error || data?.error) {
      setMessage(data?.error ?? error?.message ?? 'Unable to connect.')
      return false
    }
    setConnected(true)
    setMessage(`Connected successfully with ${data.broker?.first_name ?? 'your broker'}.`)
    return true
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')

    if (mode === 'signin' && needsName) {
      await claim()
    } else if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName, last_name: lastName, mobile } }
      })
      if (error) {
        setBusy(false)
        setMessage(error.message)
        return
      }
      if (!data.session) {
        setBusy(false)
        setMessage('Account created. Check your email to confirm it, then return to this invitation link and choose “Existing account”.')
        return
      }
      await claim()
    } else {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) {
        setBusy(false)
        setMessage(error.message)
        return
      }
      const { data: profile } = await supabase.from('profiles')
        .select('first_name,last_name,mobile').eq('id', signInData.user.id).maybeSingle()
      const first = profile?.first_name?.trim() || String(signInData.user.user_metadata?.first_name ?? '').trim()
      const last = profile?.last_name?.trim() || String(signInData.user.user_metadata?.last_name ?? '').trim()
      const savedMobile = profile?.mobile?.trim() || String(signInData.user.user_metadata?.mobile ?? '').trim()
      if (first && last) await claim(first, last, savedMobile)
      else {
        setFirstName(first); setLastName(last); setMobile(savedMobile)
        setNeedsName(true)
        setMessage('Signed in. Please confirm your name to connect with this broker.')
      }
    }

    setBusy(false)
  }

  if (!preview) {
    return <main className="center"><div className="card narrow"><BrokerRelayBrand compact /><p>{message}</p></div></main>
  }

  return (
    <main className="center">
      <div className="card joinCard">
        <BrokerRelayBrand compact />
        <p className="eyebrow">BROKER INVITATION</p>
        <h1>Connect with {preview.broker.first_name} {preview.broker.last_name}</h1>
        <p><strong>{preview.broker.title}</strong><br />{preview.organisation.name}</p>
        <p className="muted">Broker code: {preview.broker.broker_code}</p>

        {connected ? (
          <div className="success">
            <h2>Connected ✓</h2>
            <p>{message}</p>
            <p>Your account is connected. You can continue in the client app.</p>
            <Link href="/account/password">Change password</Link>
          </div>
        ) : (
          <>
            <div className="tabs">
              <button type="button" className={mode === 'signup' ? '' : 'secondary'} onClick={() => { setMode('signup'); setNeedsName(false); setMessage('') }}>New client</button>
              <button type="button" className={mode === 'signin' ? '' : 'secondary'} onClick={() => { setMode('signin'); setNeedsName(false); setMessage('') }}>Existing account</button>
            </div>
            <form onSubmit={submit}>
              {(mode === 'signup' || needsName) && <>
                <label htmlFor="join-first-name">First name</label>
                <input id="join-first-name" value={firstName} onChange={e => setFirstName(e.target.value)} required />
                <label htmlFor="join-last-name">Last name</label>
                <input id="join-last-name" value={lastName} onChange={e => setLastName(e.target.value)} required />
                <label htmlFor="join-mobile">Mobile</label>
                <input id="join-mobile" value={mobile} onChange={e => setMobile(e.target.value)} />
              </>}
              {!needsName && <>
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required />
              </>}
              <button disabled={busy}>{busy ? 'Please wait…' : needsName ? 'Confirm name & connect' : mode === 'signup' ? 'Create account & connect' : 'Sign in & connect'}</button>
            </form>
            {mode === 'signin' && !needsName && <button type="button" className="joinTextButton" disabled={busy} onClick={async () => {
              if (!email.trim()) { setMessage('Enter your email address first, then select Forgot password.'); return }
              setBusy(true); setMessage('')
              try { sessionStorage.setItem('brokerrelay-invitation-return', window.location.pathname) } catch { /* browser storage may be unavailable */ }
              const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` })
              setBusy(false)
              setMessage(error ? error.message : 'If this email has an account, a password reset link will arrive shortly. Return to this invitation after updating your password.')
            }}>Forgot password?</button>}
            {message && <div className="notice" role="status">{message}</div>}
          </>
        )}
      </div>
    </main>
  )
}
