'use client'

import Link from 'next/link'
import { Fragment, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'

type BrokerContext = {
  organisationId: string
  organisationName: string
  organisationLogoUrl: string | null
  organisationLogoWidth: number
  organisationLogoHeight: number
  brokerCode: string
  brokerTitle: string
  firstName: string
  lastName: string
}

type ClientRow = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  mobile: string | null
  status: string
  connected_at: string | null
}

type SecurityAction = {
  id: string
  organisation_name: string
  action: 'confirm_current' | 'cancel_current' | 'respond_successor'
  counterparty_name: string
  expires_at: string
}

type PortalAccess = {
  organisation_id?: string
  organisation_name?: string
  is_head_broker?: boolean
  can_manage_company?: boolean
  can_manage_staff?: boolean
  roles?: string[]
  permissions?: string[]
}

export default function DashboardPage() {
  const [context, setContext] = useState<BrokerContext | null>(null)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [mobileInviteLink, setMobileInviteLink] = useState('')
  const [browserInviteLink, setBrowserInviteLink] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [securityActions, setSecurityActions] = useState<SecurityAction[]>([])
  const [portalAccess, setPortalAccess] = useState<PortalAccess>({})
  const [isPlatformOwner, setIsPlatformOwner] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null)

  async function loadUnread() {
    const { data, error } = await supabase.rpc('get_my_unread_counts')
    if (error) return
    const next: Record<string, number> = {}
    for (const row of data ?? []) {
      next[row.client_id] = Number(row.unread_count ?? 0)
    }
    setUnread(next)
  }

  async function load() {
    const { data: authData } = await supabase.auth.getUser()
    const user = authData.user
    if (!user) {
      window.location.href = '/login'
      return
    }

    const { data: owner } = await supabase.from('platform_admins')
      .select('user_id').eq('user_id', user.id).maybeSingle()
    setIsPlatformOwner(Boolean(owner) && user.email?.toLowerCase() === 'aruna@aidez.com.au')

    const { data: accessData } = await supabase.rpc('get_my_portal_access')
    const access = (accessData ?? {}) as PortalAccess
    setPortalAccess(access)

    const { data: actionData } = await supabase.rpc('get_my_security_actions')
    setSecurityActions((actionData ?? []) as SecurityAction[])

    const { data: broker, error: brokerError } = await supabase
      .from('broker_profiles')
      .select('organisation_id, broker_code, title')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (brokerError || !broker) {
      if (access.can_manage_staff) {
        window.location.href = '/admin'
        return
      }
      const { data: platformAdmin } = await supabase
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (platformAdmin) {
        window.location.href = '/platform/setup'
        return
      }
      setMessage('No active broker profile found for this user.')
      return
    }

    const [{ data: org }, { data: profile }] = await Promise.all([
      supabase.from('organisations').select('name,logo_url,logo_display_width,logo_display_height').eq('id', broker.organisation_id).single(),
      supabase.from('profiles').select('first_name,last_name').eq('id', user.id).single(),
    ])

    setContext({
      organisationId: broker.organisation_id,
      organisationName: org?.name ?? 'Organisation',
      organisationLogoUrl: org?.logo_url ?? null,
      organisationLogoWidth: org?.logo_display_width ?? 160,
      organisationLogoHeight: org?.logo_display_height ?? 72,
      brokerCode: broker.broker_code,
      brokerTitle: broker.title,
      firstName: profile?.first_name ?? '',
      lastName: profile?.last_name ?? '',
    })

    const { data: clientData, error: clientsError } = await supabase
      .from('clients')
      .select('id,first_name,last_name,email,mobile,status,connected_at')
      .eq('organisation_id', broker.organisation_id)
      .not('connected_at', 'is', null)
      .order('connected_at', { ascending: false })

    if (clientsError) setMessage(clientsError.message)
    setClients((clientData ?? []) as ClientRow[])
    await loadUnread()
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('brokerdesk-unread-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => { loadUnread() },
      )
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  async function createInvite() {
    if (!context) return
    setBusy(true)
    setMessage('')
    setMobileInviteLink('')
    setBrowserInviteLink('')

    const { data, error } = await supabase.functions.invoke('create-client-invite', {
      body: {
        organisation_id: context.organisationId,
        expires_in_hours: 72,
      }
    })
    setBusy(false)

    if (error || data?.error) {
      setMessage(data?.error ?? error?.message ?? 'Unable to create invitation.')
      return
    }

    setMobileInviteLink(data.deep_link)
    setBrowserInviteLink(`${window.location.origin}/join/${data.token}`)
    setExpiresAt(data.expires_at)
  }

  async function copyMobileInvite() {
    await navigator.clipboard.writeText(mobileInviteLink)
    setMessage('Mobile invitation link copied.')
  }

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const search = clientSearch.trim().toLocaleLowerCase()
  const visibleClients = clients.filter(c => !search || [c.first_name, c.last_name,
    `${c.first_name} ${c.last_name}`, c.email, c.mobile].some(value => value?.toLocaleLowerCase().includes(search)))
  const unreadTotal = Object.values(unread).reduce((total, count) => total + count, 0)

  return (
    <main className="brokerDeskShell" id="home">
      <header className="brokerDeskHeader">
        <BrokerRelayBrand compact />
        <div className="brokerDeskAccount">
          <span>{context?.organisationName ?? 'BrokerDesk'}</span>
          <details><summary><span className="brokerDeskAvatar">{context?.firstName?.slice(0, 1).toUpperCase() || 'B'}</span><span>{context?.firstName || 'Broker'} · {context?.brokerTitle || 'BrokerDesk'}</span>⌄</summary>
            <div className="brokerDeskAccountMenu"><Link href="/account/password">Change password</Link><button type="button" onClick={signOut}>Sign out</button></div>
          </details>
        </div>
      </header>
      <div className="brokerDeskLayout"><nav className="brokerDeskNav" aria-label="Broker Desk navigation">
        <a className="brokerDeskNavActive" href="#home">⌂ &nbsp; Home</a>
        <a href="#clients">♙ &nbsp; Clients</a>
        <Link href="/messages">✉ &nbsp; Messages {unreadTotal > 0 && <span className="unreadBadge">{unreadTotal}</span>}</Link>
        <Link href="/applications">▤ &nbsp; Applications</Link>
        <Link href="/documents">▣ &nbsp; Document requests</Link>
        <Link href="/clients/team">♙ &nbsp; Manage team</Link>
        <Link href="/announcements">◈ &nbsp; Announcements</Link>
        <Link href="/settings/follow-up-templates">⚙ &nbsp; Follow-up settings</Link>
        {portalAccess.can_manage_staff && <Link href="/admin">⚙ &nbsp; Company &amp; staff</Link>}
        {portalAccess.is_head_broker && <Link href="/admin/document-delivery">▣ &nbsp; Delivery settings</Link>}
        {portalAccess.is_head_broker && <Link href="/settings/mobile-appearance">◈ &nbsp; Mobile appearance</Link>}
        {isPlatformOwner && <Link href="/platform/companies">▦ &nbsp; Platform companies</Link>}
        <Link className="brokerDeskHelpLink" href="/help">ⓘ &nbsp; Help &amp; Support</Link>
      </nav><div className="brokerDeskMain">

      <section className="hero">
        <div className="brokerDeskHeroIdentity">
          {context?.organisationLogoUrl && <span className="brokerDeskCompanyLogo" style={{ width: `${context.organisationLogoWidth + 20}px`, height: `${context.organisationLogoHeight + 20}px` }}><img src={context.organisationLogoUrl} alt={`${context.organisationName} logo`} style={{ width: `${context.organisationLogoWidth}px`, height: `${context.organisationLogoHeight}px` }} /></span>}
          <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>{context ? `${context.organisationName} Broker Desk` : 'Loading broker…'}</h1>
          {context && <p>Welcome, {context.firstName || 'Broker'} · {context.brokerTitle}</p>}
          </div>
        </div>
        <button onClick={createInvite} disabled={busy || !context}>
          {busy ? 'Creating…' : '+ New client invitation'}
        </button>
      </section>

      {message && <div className="notice">{message}</div>}

      {securityActions.length > 0 && (
        <section className="card" style={{ marginBottom: 16, borderLeft: '4px solid #b45309' }}>
          <p className="eyebrow">SECURITY ACTIONS</p>
          <h2>Head Broker ownership confirmation</h2>
          {securityActions.map(action => (
            <div className="sectionHead" key={action.id}>
              <div>
                <strong>{action.organisation_name}</strong>
                <p className="muted">
                  {action.action === 'confirm_current'
                    ? `Confirm the proposed handover to ${action.counterparty_name}.`
                    : action.action === 'cancel_current'
                      ? `${action.counterparty_name} has been asked to accept. You may cancel before acceptance.`
                      : `${action.counterparty_name} nominated you as the new Head Broker. Accept or decline.`}
                  {' '}Expires {new Date(action.expires_at).toLocaleString()}.
                </p>
              </div>
              <Link className="button" href={`/security/ownership-transfer?id=${action.id}`}>Review securely</Link>
            </div>
          ))}
        </section>
      )}

      {mobileInviteLink && (
        <section className="card invite">
          <div>
            <p className="eyebrow">MOBILE CLIENT INVITATION</p>
            <h2>Invitation ready</h2>
            <p className="muted">Valid until {new Date(expiresAt).toLocaleString()}</p>
            <input readOnly value={mobileInviteLink} />
            <div className="row">
              <button onClick={copyMobileInvite}>Copy mobile link</button>
              <a className="button secondary" href={browserInviteLink} target="_blank">Open browser test page</a>
            </div>
            <p className="muted">The QR opens the client invitation in the mobile app.</p>
          </div>
          <div className="qr"><QRCodeSVG value={mobileInviteLink} size={180} /></div>
        </section>
      )}

      <div className="brokerDeskOverview" aria-label="Workspace overview">
        <a href="#clients" className="brokerDeskMetric"><span>♙</span><strong>{clients.length}</strong><small>Connected clients</small></a>
        <a href="#clients" className="brokerDeskMetric"><span>✉</span><strong>{unreadTotal}</strong><small>Unread messages</small></a>
        <Link href="/announcements" className="brokerDeskMetric"><span>◈</span><strong>Announcements</strong><small>Send a client update →</small></Link>
      </div>

      <section className="card brokerDeskClients" id="clients">
        <div className="sectionHead">
          <div>
            <p className="eyebrow">CLIENTS</p>
            <h2>Connected clients</h2>
          </div>
          <span className="pill">{clients.length}</span>
        </div>
        {clients.length > 0 && <><label className="brokerDeskSearchLabel" htmlFor="client-search">Search clients</label><input id="client-search" className="brokerDeskSearch" type="search" value={clientSearch} onChange={event => setClientSearch(event.target.value)} placeholder="Name, email, or mobile" /></>}
        {clients.length === 0 ? (
          <p className="muted brokerDeskEmpty">No connected clients yet. Invite your first client above.</p>
        ) : visibleClients.length === 0 ? (
          <p className="muted brokerDeskEmpty">No clients match your search.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Client</th><th>Contact</th><th>Status</th><th>Messages</th><th>Application</th><th>Team</th></tr></thead>
              <tbody>
                {visibleClients.map(c => (
                  <Fragment key={c.id}>
                  <tr>
                    <td><button className="brokerDeskClientToggle" type="button" aria-expanded={expandedClientId === c.id} onClick={() => setExpandedClientId(current => current === c.id ? null : c.id)}>{c.first_name} {c.last_name} <span aria-hidden="true">{expandedClientId === c.id ? '⌃' : '⌄'}</span></button><small>Connected {c.connected_at ? new Date(c.connected_at).toLocaleDateString('en-AU') : '—'}</small></td>
                    <td>{c.email ?? '—'}<small>{c.mobile ?? ''}</small></td>
                    <td><span className="pill">{c.status}</span></td>
                    <td>
                      <Link className="messageLink" href={`/messages/${c.id}`}>
                        Message
                        {(unread[c.id] ?? 0) > 0 && <span className="unreadBadge">{unread[c.id]}</span>}
                      </Link>
                    </td>
                    <td><Link className="applicationLink" href={`/applications/${c.id}`}>Application</Link></td>
                    <td><Link className="applicationLink" href={`/clients/${c.id}/team`}>Manage</Link></td>
                  </tr>
                  {expandedClientId === c.id && <tr className="brokerDeskProfileRow" id={`client-details-${c.id}`}><td colSpan={6}>
                    <div className="brokerDeskProfilePanel"><div><p className="eyebrow">CLIENT PROFILE</p><h3>{c.first_name} {c.last_name}</h3>
                      <dl><div><dt>Email</dt><dd>{c.email ?? 'Not provided'}</dd></div><div><dt>Mobile</dt><dd>{c.mobile ?? 'Not provided'}</dd></div><div><dt>Status</dt><dd>{c.status}</dd></div><div><dt>Connected</dt><dd>{c.connected_at ? new Date(c.connected_at).toLocaleDateString('en-AU') : '—'}</dd></div></dl></div>
                      <div className="brokerDeskProfileActions"><Link className="button" href={`/messages/${c.id}`}>Secure messages</Link><Link className="button secondary" href={`/applications/${c.id}`}>Applications</Link><Link className="button secondary" href={`/documents/${c.id}`}>Document requests</Link><Link className="button secondary" href={`/clients/${c.id}/team`}>Service team</Link></div>
                    </div>
                  </td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div></div>
    </main>
  )
}
