'use client'

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

export default function DashboardPage() {
  const [context, setContext] = useState<BrokerContext | null>(null)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [inviteLink, setInviteLink] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data: authData } = await supabase.auth.getUser()
    const user = authData.user
    if (!user) {
      window.location.href = '/login'
      return
    }

    const { data: broker, error: brokerError } = await supabase
      .from('broker_profiles')
      .select('organisation_id, broker_code, title')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (brokerError || !broker) {
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
      .order('created_at', { ascending: false })

    if (clientsError) setMessage(clientsError.message)
    setClients((clientData ?? []) as ClientRow[])
  }

  useEffect(() => { load() }, [])

  async function createInvite() {
    if (!context) return
    setBusy(true)
    setMessage('')
    setInviteLink('')
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

    const link = `${window.location.origin}/join/${data.token}`
    setInviteLink(link)
    setExpiresAt(data.expires_at)
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteLink)
    setMessage('Invitation link copied.')
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
        <button className="secondary small" onClick={signOut}>Sign out</button>
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

      {inviteLink && (
        <section className="card invite">
          <div>
            <p className="eyebrow">CLIENT INVITATION</p>
            <h2>Invitation ready</h2>
            <p className="muted">Valid until {new Date(expiresAt).toLocaleString()}</p>
            <input readOnly value={inviteLink} />
            <div className="row">
              <button onClick={copyInvite}>Copy link</button>
              <a className="button secondary" href={inviteLink} target="_blank">Open test page</a>
            </div>
          </div>
          <div className="qr"><QRCodeSVG value={inviteLink} size={180} /></div>
        </section>
      )}

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
              <thead><tr><th>Client</th><th>Email</th><th>Mobile</th><th>Status</th><th>Connected</th></tr></thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id}>
                    <td><strong>{c.first_name} {c.last_name}</strong></td>
                    <td>{c.email ?? '—'}</td>
                    <td>{c.mobile ?? '—'}</td>
                    <td><span className="pill">{c.status}</span></td>
                    <td>{c.connected_at ? new Date(c.connected_at).toLocaleDateString() : '—'}</td>
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
