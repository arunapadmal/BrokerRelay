'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Company = { id: string; name: string; legal_name: string | null; abn: string | null; status: string }

function validAbn(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 11) return false
  const numbers = digits.split('').map(Number)
  numbers[0] -= 1
  return numbers.reduce((sum, digit, index) => sum + digit * [10,1,3,5,7,9,11,13,15,17,19][index], 0) % 89 === 0
}

export default function PlatformCompaniesPage() {
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadCompanies() {
    const { data, error: loadError } = await supabase.from('organisations')
      .select('id,name,legal_name,abn,status').order('created_at', { ascending: true })
    if (loadError) { setError(loadError.message); return }
    setCompanies((data ?? []) as Company[])
  }

  useEffect(() => {
    void (async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser()
      if (authError || !auth.user) { window.location.href = '/login'; return }
      const { data: owner, error: ownerError } = await supabase.from('platform_admins')
        .select('user_id').eq('user_id', auth.user.id).maybeSingle()
      if (ownerError || !owner || auth.user.email?.toLowerCase() !== 'aruna@aidez.com.au') {
        window.location.href = '/dashboard'; return
      }
      await loadCompanies()
      setReady(true)
    })()
  }, [])

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const abn = String(form.get('abn') ?? '')
    if (!validAbn(abn)) { setError('Enter an 11-digit ABN that passes the checksum.'); return }
    const headEmail = String(form.get('head_broker_email') ?? '').trim().toLowerCase()
    if (!headEmail) { setError('Enter the verified account email of the initial Head Broker.'); return }
    setBusy(true); setError(''); setSuccess('')
    const { data: companyId, error: createError } = await supabase.rpc('platform_create_company_with_delivery', {
      p_name: String(form.get('name') ?? ''),
      p_legal_name: String(form.get('legal_name') ?? ''),
      p_abn: abn,
      p_billing_email: String(form.get('billing_email') ?? ''),
      p_contact_phone: String(form.get('contact_phone') ?? ''),
      p_website: String(form.get('website') ?? ''),
      p_broker_code: String(form.get('broker_code') ?? ''),
      p_head_broker_email: headEmail,
      p_document_delivery_email: String(form.get('document_delivery_email') ?? ''),
    })
    setBusy(false)
    if (createError) { setError(createError.message); return }
    formElement.reset()
    setSuccess(`Company created (${companyId}). The Head Broker must verify the document delivery email before requesting documents.`)
    await loadCompanies()
  }

  if (!ready) return <main className="page"><p>Checking platform access…</p></main>
  return <main className="page">
    <header className="topbar">
      <div><div className="brand">BROKERRELAY</div><strong>Platform companies</strong></div>
      <Link className="button secondary small" href="/dashboard">BrokerDesk</Link>
    </header>
    <section className="card" style={{margin:'24px 0'}}>
      <p className="eyebrow">INDEPENDENT COMPANIES</p>
      <h1>Companies</h1>
      <p className="muted">Every company uses the same roles, workflows and security controls. Company records remain separate; there is no company merge action.</p>
      {companies.length === 0 ? <p>No companies yet.</p> :
        <div className="tableWrap"><table>
          <thead><tr><th>Trading name</th><th>Legal name</th><th>ABN</th><th>Status</th></tr></thead>
          <tbody>{companies.map(company => <tr key={company.id}>
            <td>{company.name}</td><td>{company.legal_name ?? '—'}</td>
            <td>{company.abn ?? '—'}</td><td>{company.status}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
    <section className="card" style={{maxWidth:900,margin:'24px auto'}}>
      <p className="eyebrow">OWNER PROVISIONING</p><h2>Create another company</h2>
      <p className="muted">Use verified company details. The Head Broker must already have a verified login and must never have held a staff membership in another company. The legal identity is locked on creation.</p>
      {error && <div className="notice error" role="alert">{error}</div>}
      {success && <div className="notice" role="status">{success}</div>}
      <form onSubmit={createCompany}>
        <label>Trading name<input name="name" maxLength={160} required /></label>
        <label>Legal name<input name="legal_name" maxLength={200} required /></label>
        <div className="formGrid">
          <label>ABN<input name="abn" inputMode="numeric" placeholder="11 digits" required /></label>
          <label>Billing email<input name="billing_email" type="email" required /></label>
          <label>Document delivery email<input name="document_delivery_email" type="email" required /></label>
          <label>Phone<input name="contact_phone" type="tel" /></label>
          <label>Website<input name="website" type="url" placeholder="https://example.com.au" /></label>
          <label>Initial Head Broker account email<input name="head_broker_email" type="email" required /></label>
          <label>Head Broker code<input name="broker_code" maxLength={80} required /></label>
        </div>
        <p className="muted">This creates the company and assigns its own Head Broker. Your platform account receives no membership in the new company.</p>
        <button disabled={busy}>{busy ? 'Creating company…' : 'Create company'}</button>
      </form>
    </section>
  </main>
}
