'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'
import { CompanyLogoEditor } from '@/components/CompanyLogoEditor'
import { supabase } from '@/lib/supabase'

type Company = {
  id: string
  name: string
  legal_name: string | null
  abn: string | null
  status: string
  created_at: string
  billing_email: string | null
  contact_phone: string | null
  website: string | null
  head_broker_name: string | null
  head_broker_mobile: string | null
  head_broker_email: string | null
  logo_url: string | null
  logo_display_width: number
  logo_display_height: number
}

export default function PlatformCompanyInformationPage() {
  const params = useParams<{ companyId: string }>()
  const [company, setCompany] = useState<Company | null>(null)
  const [message, setMessage] = useState('Loading company…')
  const [authorised, setAuthorised] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) { window.location.href = '/login'; return }
      const { data: owner } = await supabase.from('platform_admins').select('user_id').eq('user_id', auth.user.id).maybeSingle()
      if (!owner || auth.user.email?.toLowerCase() !== 'aruna@aidez.com.au') { window.location.href = '/dashboard'; return }
      setAuthorised(true)
      const [{ data, error }, { data: logoData, error: logoError }] = await Promise.all([
        supabase.rpc('platform_company_contact_overview_v2'),
        supabase.from('organisations').select('logo_url,logo_display_width,logo_display_height').eq('id', params.companyId).single(),
      ])
      if (error) { setMessage(error.message); return }
      if (logoError) { setMessage(logoError.message); return }
      const found = (data as Company[] | null)?.find(row => row.id === params.companyId)
      if (!found) { setMessage('Company not found.'); return }
      setCompany({ ...found, logo_url: logoData.logo_url, logo_display_width: logoData.logo_display_width, logo_display_height: logoData.logo_display_height })
      setMessage('')
    }
    void load()
  }, [params.companyId])

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) { setMessage(`Could not sign out: ${error.message}`); return }
    window.location.href = '/login'
  }

  if (!authorised) return <main className="center"><p>Checking platform access…</p></main>
  return <main className="platformShell">
    <header className="platformHeader"><BrokerRelayBrand compact />
      <details className="platformAccount"><summary><span className="platformAvatar" aria-hidden="true">A</span><span><strong>Aruna Weerakkody</strong><small>Platform Owner</small></span><span className="platformChevron" aria-hidden="true">⌄</span></summary><div className="platformAccountMenu"><Link href="/dashboard">Broker Desk</Link><button type="button" onClick={signOut}>Sign out</button></div></details>
    </header>
    <div className="platformBody"><nav className="platformSidebar" aria-label="Platform navigation">
      <Link className="platformNavActive" href="/platform/companies"><span aria-hidden="true">▦</span> Companies</Link>
      <Link href="/platform/companies#invitations"><span aria-hidden="true">✉</span> Invitations</Link>
      <div className="platformSidebarBottom"><Link href="/dashboard"><span aria-hidden="true">⌂</span> Broker Desk</Link></div>
    </nav><div className="platformMain"><div className="platformDetailsPage">
    <Link className="backLink" href="/platform/companies">← All companies</Link>
    {message && <div className="notice" role="status">{message}</div>}
    {company && <>
      <div className="platformDetailsHeading"><div><p className="eyebrow">COMPANY INFORMATION</p><h1>{company.name}</h1><span className={`platformStatus ${company.status === 'active' ? 'isActive' : ''}`}>{company.status}</span></div></div>
      <div className="platformDetailsGrid">
        <section className="card"><h2>Company branding</h2><CompanyLogoEditor companyId={company.id} companyName={company.name} logoUrl={company.logo_url} logoWidth={company.logo_display_width} logoHeight={company.logo_display_height} onUpdated={url => setCompany(current => current ? { ...current, logo_url: url } : current)} onDimensionsUpdated={(width,height) => setCompany(current => current ? { ...current, logo_display_width: width, logo_display_height: height } : current)} /></section>
        <section className="card"><h2>Head Broker</h2><dl>
          <div><dt>Contact person</dt><dd>{company.head_broker_name ?? 'Not provided'}</dd></div>
          <div><dt>Email address</dt><dd>{company.head_broker_email ? <a href={`mailto:${company.head_broker_email}`}>{company.head_broker_email}</a> : 'Not provided'}</dd></div>
          <div><dt>Mobile number</dt><dd>{company.head_broker_mobile ? <a href={`tel:${company.head_broker_mobile.replace(/[^+\d]/g, '')}`}>{company.head_broker_mobile}</a> : 'Not provided'}</dd></div>
        </dl></section>
        <section className="card"><h2>Company details</h2><dl>
          <div><dt>Trading name</dt><dd>{company.name}</dd></div>
          <div><dt>Legal name</dt><dd>{company.legal_name ?? 'Not provided'}</dd></div>
          <div><dt>ABN</dt><dd>{company.abn ?? 'Not provided'}</dd></div>
          <div><dt>Date added</dt><dd>{new Date(company.created_at).toLocaleDateString('en-AU')}</dd></div>
        </dl></section>
        <section className="card"><h2>Company contact</h2><dl>
          <div><dt>Business phone</dt><dd>{company.contact_phone ?? 'Not provided'}</dd></div>
          <div><dt>Billing email</dt><dd>{company.billing_email ?? 'Not provided'}</dd></div>
          <div><dt>Website</dt><dd>{company.website ? <a href={company.website} target="_blank" rel="noopener noreferrer">{company.website}</a> : 'Not provided'}</dd></div>
        </dl></section>
      </div>
    </>}
    </div></div></div>
  </main>
}
