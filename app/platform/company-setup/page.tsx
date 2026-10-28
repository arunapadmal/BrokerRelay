'use client'

import Link from 'next/link'
import { legalDocuments } from '@/lib/legal-documents'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'
import { MobileBrandingEditor, brandingIsReadable, defaultMobileBranding, type MobileBranding } from '@/components/MobileBrandingEditor'
import '@/components/mobile-branding.css'

type Invitation = { id: string; head_name: string; head_email: string; head_mobile: string }
function validAbn(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 11) return false
  const numbers = digits.split('').map(Number); numbers[0] -= 1
  return numbers.reduce((sum, digit, index) => sum + digit * [10,1,3,5,7,9,11,13,15,17,19][index], 0) % 89 === 0
}

export default function CompanySetupPage() {
  const [step, setStep] = useState<'terms' | 'password' | 'company'>('terms')
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [authority, setAuthority] = useState(false)
  const [email, setEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [signedIn, setSignedIn] = useState(false)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('Opening your invitation…')
  const [busy, setBusy] = useState(false)
  const [branding, setBranding] = useState<MobileBranding>(defaultMobileBranding)
  const [companyName, setCompanyName] = useState('')
  const [referrer, setReferrer] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      // Supabase processes the email callback before this RPC gets the session.
      const { data: session } = await supabase.auth.getSession()
      if (!session.session) { setSignedIn(false); setInvitation(null); setMessage('Open your invitation email to verify your account, or sign in below to resume.'); return }
      setSignedIn(true)
      const owner = await supabase.from('platform_admins').select('user_id').eq('user_id',session.session.user.id).maybeSingle()
      if (owner.data) { window.location.replace('/platform/dashboard'); return }
      const { data, error } = await supabase.rpc('my_company_setup_invitation')
      if (error || !data?.[0]) { setMessage(error?.message ?? 'No active company invitation was found for this email.'); return }
      const attribution = await supabase.rpc('my_company_invitation_referrer')
      if (attribution.error) { setMessage(attribution.error.message); return }
      setReferrer(attribution.data as string | null)
      setInvitation(data[0] as Invitation); setMessage('')
    }
    void load()
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => { if (session) setTimeout(() => { void load() }, 0); else { setSignedIn(false); setInvitation(null) } })
    return () => subscription.subscription.unsubscribe()
  }, [])

  async function acceptTerms(event: FormEvent) {
    event.preventDefault()
    if (!invitation || busy || !terms || !privacy || !authority) return
    setBusy(true); setMessage('')
    const { error } = await supabase.rpc('record_company_setup_acceptance', {
      p_invitation_id: invitation.id, p_terms_version: legalDocuments[0].version,
      p_privacy_version: legalDocuments[1].version, p_terms_accepted: terms,
      p_privacy_acknowledged: privacy, p_authority_confirmed: authority,
    })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    setStep('password')
  }

  async function createPassword(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (password.length < 10 || password !== confirm) { setMessage('Use at least 10 characters and enter the same password twice.'); return }
    setBusy(true); setMessage('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    setPassword(''); setConfirm(''); setStep('company')
  }

  async function signIn(event: FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setMessage('')
    const { error } = await supabase.auth.signInWithPassword({email: email.trim(), password: loginPassword})
    setBusy(false); setLoginPassword('')
    if (error) setMessage(error.message)
  }

  async function requestLink() {
    if (!email.trim() || busy) { setMessage('Enter your invited email address first.'); return }
    setBusy(true); setMessage('')
    const { error } = await supabase.auth.signInWithOtp({email:email.trim(),options:{shouldCreateUser:false,emailRedirectTo:window.location.origin+'/platform/company-setup'}})
    setBusy(false); setMessage(error ? error.message : 'If this account is eligible, a verification link will arrive. If your invitation has expired, ask the platform owner to resend it.')
  }

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!invitation || busy) return
    const form = new FormData(event.currentTarget)
    if (step !== 'company') return
    if (!validAbn(String(form.get('abn') ?? ''))) { setMessage('Enter an 11-digit ABN that passes the checksum.'); return }
    if (!brandingIsReadable(branding)) { setMessage('Choose readable button and notification colours.'); return }
    setBusy(true); setMessage('')
    const { data: organisationId, error } = await supabase.rpc('accept_company_setup_with_branding', {
      p_invitation_id: invitation.id,
      p_name: String(form.get('name') ?? ''), p_legal_name: String(form.get('legal_name') ?? ''),
      p_abn: String(form.get('abn') ?? ''), p_billing_email: String(form.get('billing_email') ?? ''),
      p_document_delivery_email: String(form.get('document_delivery_email') ?? ''),
      p_phone: String(form.get('phone') ?? ''), p_website: String(form.get('website') ?? ''),
      p_background_color: branding.background, p_button_color: branding.button,
      p_notification_color: branding.notification,
    })
    if (error) { setMessage(error.message); setBusy(false); return }
    window.location.href = `/settings/mobile-appearance?setup=1&org=${encodeURIComponent(organisationId as string)}`
  }

  return <main className="page" style={{maxWidth:1050}}>
    <header className="topbar"><BrokerRelayBrand /></header>
    <section className="card"><p className="eyebrow">COMPANY SETUP</p><h1>Welcome to BrokerRelay</h1>
      {message && <div role="status" className="notice">{message}</div>}
      <p className="notice">Development onboarding with sample data. <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">Terms of Service (draft)</Link> · <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy (draft)</Link>. No paid subscription is agreed by this test flow.</p>
      {!signedIn && <form onSubmit={signIn} className="billingForm">
        <h2>Open your company invitation</h2><p>New invitees: use the verification link sent to your email, then create your password. Existing users can sign in to resume.</p>
        <label>Invited email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
        <label>Password (existing users)<input type="password" autoComplete="current-password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} /></label>
        <div className="row"><button disabled={busy || !loginPassword}>Sign in to continue</button><button type="button" className="secondary" disabled={busy} onClick={()=>void requestLink()}>New account / forgot password: email a link</button></div>
      </form>}
      {signedIn && !invitation && <button type="button" className="secondary" onClick={async()=>{await supabase.auth.signOut();window.location.reload()}}>Use a different account</button>}
      {invitation && <p className="notice">Original referral: <strong>{referrer ?? 'Direct signup / no referrer'}</strong>. If this is incorrect, stop and contact the platform owner before completing setup.</p>}
      {invitation && step === 'terms' && <form onSubmit={acceptTerms} className="billingForm">
        <p>Invitation for <strong>{invitation.head_name}</strong> · {invitation.head_email}</p><h2>1. Review and agree</h2>
        <label className="check"><input type="checkbox" required checked={terms} onChange={e=>setTerms(e.target.checked)} /><span>I agree to the <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">draft Terms of Service</Link> for development testing.</span></label>
        <label className="check"><input type="checkbox" required checked={privacy} onChange={e=>setPrivacy(e.target.checked)} /><span>I acknowledge that I have read the <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">draft Privacy Policy</Link>. This is not marketing consent.</span></label>
        <label className="check"><input type="checkbox" required checked={authority} onChange={e=>setAuthority(e.target.checked)} /><span>I am authorised to set up this company and accept these terms on its behalf.</span></label>
        <button disabled={busy || !terms || !privacy || !authority}>Agree and continue</button>
      </form>}
      {invitation && step === 'password' && <form onSubmit={createPassword} className="billingForm">
        <h2>2. Create your password</h2><p>Your verified account: {invitation.head_email}. Choose a password to use for future sign-ins.</p>
        <label>Create password<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={10} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={10} /></label>
        <button disabled={busy}>Save password and continue</button>
      </form>}
      {invitation && step === 'company' && <form onSubmit={complete}>
        <p className="muted">Invited Head Broker: <strong>{invitation.head_name}</strong> · {invitation.head_email} · {invitation.head_mobile}</p>
        <h2>3. Company details</h2>
        <div className="formGrid"><label>Trading name<input name="name" maxLength={160} value={companyName} onChange={event => setCompanyName(event.target.value)} required /></label>
          <label>Legal entity name<input name="legal_name" maxLength={200} required /></label>
          <label>ABN<input name="abn" inputMode="numeric" required /></label>
          <label>Business phone<input name="phone" type="tel" required /></label>
          <label>Billing email<input name="billing_email" type="email" required /></label>
          <label>Document Delivery Email<input name="document_delivery_email" type="email" required /></label>
          <label>Website (optional)<input name="website" type="url" placeholder="https://example.com.au" /></label></div>
        <p className="muted">Client documents will be delivered to the Document Delivery Email after you verify that address in Company &amp; staff.</p>
        <h2>Mobile app appearance</h2>
        <MobileBrandingEditor value={branding} onChange={setBranding} companyName={companyName} />
        <p className="muted">After creating the company, you can upload your logo or continue with the standard icon.</p>
        <button disabled={busy || !brandingIsReadable(branding)}>{busy ? 'Setting up…' : 'Continue to logo'}</button>
      </form>}
    </section>
  </main>
}
