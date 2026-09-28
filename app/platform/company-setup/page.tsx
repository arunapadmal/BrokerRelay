'use client'

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
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('Opening your invitation…')
  const [busy, setBusy] = useState(false)
  const [branding, setBranding] = useState<MobileBranding>(defaultMobileBranding)
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    async function load() {
      // Supabase processes the email callback before this RPC gets the session.
      const { data: session } = await supabase.auth.getSession()
      if (!session.session) { setMessage('Open the current invitation link in your email to continue.'); return }
      const { data, error } = await supabase.rpc('my_company_setup_invitation')
      if (error || !data?.[0]) { setMessage(error?.message ?? 'No active company invitation was found for this email.'); return }
      setInvitation(data[0] as Invitation); setMessage('')
    }
    void load()
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => { if (session) void load() })
    return () => subscription.subscription.unsubscribe()
  }, [])

  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!invitation || busy) return
    const form = new FormData(event.currentTarget)
    if (password.length < 10 || password !== confirm) { setMessage('Use a password of at least 10 characters and enter it twice.'); return }
    if (!validAbn(String(form.get('abn') ?? ''))) { setMessage('Enter an 11-digit ABN that passes the checksum.'); return }
    if (!brandingIsReadable(branding)) { setMessage('Choose readable button and notification colours.'); return }
    setBusy(true); setMessage('')
    const { error: passwordError } = await supabase.auth.updateUser({ password })
    if (passwordError) { setMessage(passwordError.message); setBusy(false); return }
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
      {invitation && <form onSubmit={complete}>
        <p className="muted">Invited Head Broker: <strong>{invitation.head_name}</strong> · {invitation.head_email} · {invitation.head_mobile}</p>
        <h2>Your account</h2>
        <div className="formGrid"><label>Create password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={10} /></label>
          <label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required minLength={10} /></label></div>
        <h2>Company details</h2>
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
