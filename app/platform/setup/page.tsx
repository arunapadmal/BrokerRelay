'use client'

import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'

function validAbn(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 11) return false
  const values = digits.split('').map(Number)
  values[0] -= 1
  return values.reduce((sum, digit, index) => sum + digit * [10,1,3,5,7,9,11,13,15,17,19][index], 0) % 89 === 0
}

export default function ProductOwnerSetupPage() {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) { window.location.href='/login'; return }
      const { data: admin } = await supabase.from('platform_admins').select('user_id').eq('user_id',auth.user.id).maybeSingle()
      if (!admin) { window.location.href='/dashboard'; return }
      const { data: membership } = await supabase.from('organisation_memberships').select('id').eq('user_id',auth.user.id).is('removed_at',null).maybeSingle()
      if (membership) { window.location.href='/dashboard'; return }
      setReady(true)
    })()
  }, [])

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const abn=String(form.get('abn')??'')
    if (!validAbn(abn)) { setError('Enter a genuine 11-digit Australian ABN that passes the ABN checksum.'); return }
    setBusy(true); setError('')
    const { error: createError } = await supabase.rpc('platform_create_initial_company', {
      p_name:String(form.get('name')??''), p_legal_name:String(form.get('legal_name')??''), p_abn:abn,
      p_billing_email:String(form.get('billing_email')??''), p_contact_phone:String(form.get('contact_phone')??''),
      p_website:String(form.get('website')??''), p_broker_code:String(form.get('broker_code')??''),
    })
    setBusy(false)
    if (createError) { setError(createError.message); return }
    window.location.href='/dashboard'
  }

  if (!ready) return <main className="page"><p>Checking Product Owner access…</p>{error&&<div className="notice error">{error}</div>}</main>
  return <main className="page">
    <header className="topbar"><div><BrokerRelayBrand compact /><strong>Product Owner setup</strong></div></header>
    <section className="card" style={{maxWidth:900,margin:'32px auto'}}>
      <p className="eyebrow">INITIAL COMPANY</p><h1>Create your first company</h1>
      <p className="muted">These are legal identity details. After creation, trading name, legal name and ABN are locked. A different legal entity must be created as a new company.</p>
      {error&&<div className="notice error">{error}</div>}
      <form onSubmit={createCompany}>
        <label>Trading name<input name="name" maxLength={160} required /></label>
        <label>Legal name<input name="legal_name" maxLength={200} required /></label>
        <div className="formGrid">
          <label>ABN<input name="abn" inputMode="numeric" placeholder="11 digits" required /></label>
          <label>Billing email<input name="billing_email" type="email" required /></label>
          <label>Phone<input name="contact_phone" type="tel" /></label>
          <label>Website<input name="website" type="url" placeholder="https://example.com.au" /></label>
          <label>Your broker code<input name="broker_code" maxLength={80} required /></label>
        </div>
        <div className="notice">Your current Product Owner account will become this company's initial Head Broker with full company authority.</div>
        <button disabled={busy}>{busy?'Creating company…':'Create company and continue'}</button>
      </form>
    </section>
  </main>
}
