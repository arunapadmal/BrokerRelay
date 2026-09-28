'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'
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
}

export default function PlatformCompanyInformationPage() {
  const params = useParams<{ companyId: string }>()
  const [company, setCompany] = useState<Company | null>(null)
  const [message, setMessage] = useState('Loading company…')

  useEffect(() => {
    async function load() {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user) { window.location.href = '/login'; return }
      if (auth.user.email?.toLowerCase() !== 'aruna@aidez.com.au') { window.location.href = '/dashboard'; return }
      const { data, error } = await supabase.rpc('platform_company_contact_overview')
      if (error) { setMessage(error.message); return }
      const found = (data as Company[] | null)?.find(row => row.id === params.companyId)
      if (!found) { setMessage('Company not found.'); return }
      setCompany(found)
      setMessage('')
    }
    void load()
  }, [params.companyId])

  return <main className="page platformDetailsPage">
    <header className="topbar"><BrokerRelayBrand compact /><Link className="button secondary small" href="/platform/companies">← All companies</Link></header>
    {message && <div className="notice" role="status">{message}</div>}
    {company && <>
      <div className="platformDetailsHeading"><div><p className="eyebrow">COMPANY INFORMATION</p><h1>{company.name}</h1><span className={`platformStatus ${company.status === 'active' ? 'isActive' : ''}`}>{company.status}</span></div></div>
      <div className="platformDetailsGrid">
        <section className="card"><h2>Head Broker</h2><dl>
          <div><dt>Contact person</dt><dd>{company.head_broker_name ?? 'Not provided'}</dd></div>
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
  </main>
}
