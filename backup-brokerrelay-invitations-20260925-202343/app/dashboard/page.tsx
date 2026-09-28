'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'

type BrokerContext = {
  organisationId: string
  organisationName: string
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
      supabase.from('organisations').select('name').eq('id', broker.organisation_id).single(),
      supabase.from('profiles').select('first_name,last_name').eq('id', user.id).single(),
    ])

    setContext({
      organisationId: broker.organisation_id,
      organisationName: org?.name ?? 'Organisation',
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

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <div className="brand">AIDEZ</div>
          <strong>BrokerDesk</strong>
        </div>
        <div className="row">
          {isPlatformOwner && <Link className="button secondary small" href="/platform/companies">Platform companies</Link>}
          {portalAccess.can_manage_staff && <Link className="button secondary small" href="/admin">Company &amp; staff</Link>}
          <button className="secondary small" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">DEVELOPMENT WORKSPACE</p>
          <h1>{context ? `Good morning, ${context.firstName || 'Broker'}` : 'Loading broker…'}</h1>
          {context && <p>{context.organisationName} · {context.brokerTitle} · {context.brokerCode}</p>}
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
            <p className="muted">The QR uses the AidezConnect mobile deep link.</p>
          </div>
          <div className="qr"><QRCodeSVG value={mobileInviteLink} size={180} /></div>
        </section>
      )}

      <section
        className="card"
        style={{ marginBottom: 16, borderLeft: '4px solid var(--company-accent, #111878)' }}
      >
        <div className="sectionHead">
          <div>
            <p className="eyebrow">CLIENT COMMUNICATION</p>
            <h2>Announcements</h2>
            <p className="muted">Send an occasional update to all or selected clients.</p>
          </div>
          <Link className="button secondary" href="/announcements">Open announcements</Link>
        </div>
      </section>

      <section className="card">
        <div className="sectionHead">
          <div>
            <p className="eyebrow">CLIENTS</p>
            <h2>Connected clients</h2>
          </div>
          <span className="pill">{clients.length}</span>
        </div>
        {clients.length === 0 ? (
          <p className="muted">No connected clients yet.</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Client</th><th>Email</th><th>Mobile</th><th>Status</th><th>Connected</th><th>Secure messages</th><th>Loan progress</th><th>Service team</th></tr></thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id}>
                    <td><strong>{c.first_name} {c.last_name}</strong></td>
                    <td>{c.email ?? '—'}</td>
                    <td>{c.mobile ?? '—'}</td>
                    <td><span className="pill">{c.status}</span></td>
                    <td>{c.connected_at ? new Date(c.connected_at).toLocaleDateString() : '—'}</td>
                    <td>
                      <Link className="messageLink" href={`/messages/${c.id}`}>
                        Message
                        {(unread[c.id] ?? 0) > 0 && <span className="unreadBadge">{unread[c.id]}</span>}
                      </Link>
                    </td>
                    <td><Link className="applicationLink" href={`/applications/${c.id}`}>Application</Link></td>
                    <td><Link className="applicationLink" href={`/clients/${c.id}/team`}>Manage</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
