'use client'

import Link from 'next/link'
import { ReactNode, useEffect, useState } from 'react'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'
import { supabase } from '@/lib/supabase'

type Props = {
  clientId?: string
  section: 'active' | 'archive' | 'replacement' | 'team' | 'documents' | 'settings' | 'messages' | 'help' | 'delivery' | 'mobile'
  children: ReactNode
}

export function ApplicationWorkspaceShell({ clientId, section, children }: Props) {
  const [companyName, setCompanyName] = useState('BrokerDesk')
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)
  const [accountName, setAccountName] = useState('Broker')
  const [canManageStaff, setCanManageStaff] = useState(false)
  const [isHeadBroker, setIsHeadBroker] = useState(false)
  const [isPlatformOwner, setIsPlatformOwner] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function loadIdentity() {
      const { data: auth } = await supabase.auth.getUser()
      if (!active || !auth.user) return
      const [{ data: client }, { data: profile }, { data: access }, { data: owner }] = await Promise.all([
        clientId
          ? supabase.from('clients').select('organisation_id').eq('id', clientId).maybeSingle()
          : supabase.from('broker_profiles').select('organisation_id').eq('user_id', auth.user.id).eq('is_active', true).limit(1).maybeSingle(),
        supabase.from('profiles').select('first_name,last_name').eq('id', auth.user.id).maybeSingle(),
        supabase.rpc('get_my_portal_access'),
        supabase.from('platform_admins').select('user_id').eq('user_id', auth.user.id).maybeSingle(),
      ])
      if (!active) return
      setAccountName([profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || auth.user.email || 'Broker')
      setCanManageStaff(Boolean(access?.can_manage_staff))
      setIsHeadBroker(Boolean(access?.is_head_broker))
      setIsPlatformOwner(Boolean(owner) && auth.user.email?.toLowerCase() === 'aruna@aidez.com.au')
      const organisationId = client?.organisation_id ?? access?.organisation_id
      if (organisationId) {
        const { data: organisation } = await supabase.from('organisations')
          .select('name,logo_url').eq('id', organisationId).maybeSingle()
        if (active) { setCompanyName(organisation?.name ?? 'BrokerDesk'); setCompanyLogo(organisation?.logo_url ?? null) }
      }
    }
    void loadIdentity()
    return () => { active = false }
  }, [clientId])

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) { setError(`Could not sign out: ${signOutError.message}`); return }
    window.location.href = '/login'
  }

  return <main className="brokerDeskShell applicationShell">
    <header className="brokerDeskHeader">
      <BrokerRelayBrand compact />
      <div className="brokerDeskAccount"><span className="announcementCompanyIdentity">{companyLogo && <img src={companyLogo} alt="" aria-hidden="true" />}{companyName}</span><details><summary><span className="brokerDeskAvatar">{accountName.charAt(0).toUpperCase()}</span><span>{accountName}</span>⌄</summary><div className="brokerDeskAccountMenu"><Link href="/account/password">Change password</Link><button type="button" onClick={signOut}>Sign out</button></div></details></div>
    </header>
    <div className="brokerDeskLayout"><nav className="brokerDeskNav applicationNav" aria-label="Broker Desk navigation">
      <Link href="/dashboard">⌂ &nbsp; Home</Link>
      <Link href="/dashboard#clients">♙ &nbsp; Clients</Link>
      <Link href="/messages" className={section === 'messages' ? 'brokerDeskNavActive' : undefined} aria-current={section === 'messages' ? 'page' : undefined}>✉ &nbsp; Messages</Link>
      <Link href="/applications" className={section === 'active' ? 'brokerDeskNavActive' : undefined} aria-current={section === 'active' ? 'page' : undefined}>▤ &nbsp; Applications</Link>
      {clientId && <Link href={`/applications/archive/${clientId}`} className={section === 'archive' ? 'brokerDeskNavActive' : undefined} aria-current={section === 'archive' ? 'page' : undefined}>▦ &nbsp; Archive / Past</Link>}
      {clientId && <Link href={`/applications/replacement/${clientId}`} className={section === 'replacement' ? 'brokerDeskNavActive' : undefined} aria-current={section === 'replacement' ? 'page' : undefined}>⇄ &nbsp; Replacement</Link>}
      <Link href="/documents" className={section === 'documents' ? 'brokerDeskNavActive' : undefined} aria-current={section === 'documents' ? 'page' : undefined}>▣ &nbsp; Document requests</Link>
      <Link href="/clients/team" className={section === 'team' ? 'brokerDeskNavActive' : undefined} aria-current={section === 'team' ? 'page' : undefined}>♙ &nbsp; Manage team</Link>
      <Link href="/announcements">◈ &nbsp; Announcements</Link>
      <Link href={clientId ? `/settings/follow-up-templates?clientId=${encodeURIComponent(clientId)}` : '/settings/follow-up-templates'} className={section === 'settings' ? 'brokerDeskNavActive' : undefined} aria-current={section === 'settings' ? 'page' : undefined}>⚙ &nbsp; Follow-up settings</Link>
      {canManageStaff && <Link href="/admin">♙ &nbsp; Company &amp; staff</Link>}
      {isHeadBroker && <Link href="/admin/document-delivery" className={section === 'delivery' ? 'brokerDeskNavActive' : undefined} aria-current={section === 'delivery' ? 'page' : undefined}>▣ &nbsp; Delivery settings</Link>}
      {isHeadBroker && <Link href="/settings/mobile-appearance" className={section === 'mobile' ? 'brokerDeskNavActive' : undefined} aria-current={section === 'mobile' ? 'page' : undefined}>◈ &nbsp; Mobile appearance</Link>}
      {isPlatformOwner && <Link href="/platform/companies">▦ &nbsp; Platform companies</Link>}
      <Link href="/help" className={`brokerDeskHelpLink${section === 'help' ? ' brokerDeskNavActive' : ''}`} aria-current={section === 'help' ? 'page' : undefined}>ⓘ &nbsp; Help &amp; Support</Link>
    </nav><div className="brokerDeskMain applicationMain">
      {error && <div className="notice error" role="alert">{error}</div>}
      {children}
    </div></div>
  </main>
}
