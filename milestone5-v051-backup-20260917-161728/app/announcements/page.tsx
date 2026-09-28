'use client'

import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type AudienceType = 'my_clients' | 'all_company' | 'lenders' | 'selected_clients'

type Lender = {
  id: string
  name: string
}

type Client = {
  id: string
  first_name: string
  last_name: string
  email: string | null
}

type PreviewRow = {
  client_id: string
  client_name: string
  email: string | null
  connected: boolean
}

type HistoryRow = {
  announcement_id: string
  title: string
  audience_type: AudienceType
  push_requested: boolean
  recipient_count: number
  connected_count: number
  read_count: number
  sent_at: string
}

const audienceLabels: Record<AudienceType, string> = {
  my_clients: 'My clients',
  all_company: 'All company clients',
  lenders: 'By lender',
  selected_clients: 'Selected clients',
}

export default function AnnouncementsPage() {
  const [organisationId, setOrganisationId] = useState<string | null>(null)
  const [lenders, setLenders] = useState<Lender[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])

  const [audienceType, setAudienceType] = useState<AudienceType>('my_clients')
  const [selectedLenders, setSelectedLenders] = useState<string[]>([])
  const [selectedClients, setSelectedClients] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState(
    'Hi {{client_first_name}},\n\n',
  )
  const [pushRequested, setPushRequested] = useState(false)

  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [previewed, setPreviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function load() {
    setError('')

    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) {
      window.location.href = '/login'
      return
    }

    const { data: broker, error: brokerError } = await supabase
      .from('broker_profiles')
      .select('organisation_id')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .limit(1)
      .single()

    if (brokerError) {
      setError(brokerError.message)
      return
    }

    const orgId = broker.organisation_id as string
    setOrganisationId(orgId)

    const [
      { data: lenderData },
      { data: clientData },
      { data: historyData, error: historyError },
    ] = await Promise.all([
      supabase
        .from('lenders')
        .select('id,name')
        .eq('organisation_id', orgId)
        .eq('active', true)
        .order('name'),
      supabase
        .from('clients')
        .select('id,first_name,last_name,email')
        .eq('organisation_id', orgId)
        .eq('status', 'active')
        .order('first_name'),
      supabase.rpc('get_announcement_history', {
        p_organisation_id: orgId,
        p_limit: 30,
      }),
    ])

    setLenders((lenderData ?? []) as Lender[])
    setClients((clientData ?? []) as Client[])

    if (historyError) {
      setError(historyError.message)
    } else {
      setHistory((historyData ?? []) as HistoryRow[])
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    setPreview([])
    setPreviewed(false)
  }, [audienceType, selectedLenders, selectedClients])

  const connectedCount = useMemo(
    () => preview.filter((row) => row.connected).length,
    [preview],
  )

  function toggleLender(id: string) {
    setSelectedLenders((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    )
  }

  function toggleClient(id: string) {
    setSelectedClients((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    )
  }

  async function previewAudience() {
    if (!organisationId || busy) return

    if (audienceType === 'lenders' && selectedLenders.length === 0) {
      setError('Select at least one lender.')
      return
    }

    if (audienceType === 'selected_clients' && selectedClients.length === 0) {
      setError('Select at least one client.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    const { data, error: previewError } = await supabase.rpc(
      'preview_announcement_audience',
      {
        p_organisation_id: organisationId,
        p_audience_type: audienceType,
        p_lender_ids:
          audienceType === 'lenders' ? selectedLenders : null,
        p_client_ids:
          audienceType === 'selected_clients' ? selectedClients : null,
      },
    )

    setBusy(false)

    if (previewError) {
      setError(previewError.message)
      return
    }

    setPreview((data ?? []) as PreviewRow[])
    setPreviewed(true)
  }

  async function sendAnnouncement() {
    if (!organisationId || busy) return

    if (!title.trim()) {
      setError('Announcement title is required.')
      return
    }

    if (!body.trim()) {
      setError('Announcement message is required.')
      return
    }

    if (!previewed) {
      setError('Preview the audience before sending.')
      return
    }

    if (preview.length === 0) {
      setError('No clients match this audience.')
      return
    }

    if (
      !window.confirm(
        `Send "${title.trim()}" to ${preview.length} client${preview.length === 1 ? '' : 's'}? ${connectedCount} are currently connected to AidezConnect.`,
      )
    ) {
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    const { data, error: sendError } = await supabase.rpc('send_announcement', {
      p_organisation_id: organisationId,
      p_audience_type: audienceType,
      p_title: title.trim(),
      p_body: body.trim(),
      p_push_requested: pushRequested,
      p_lender_ids: audienceType === 'lenders' ? selectedLenders : null,
      p_client_ids:
        audienceType === 'selected_clients' ? selectedClients : null,
    })

    setBusy(false)

    if (sendError) {
      setError(sendError.message)
      return
    }

    const row = Array.isArray(data) ? data[0] : data
    setNotice(
      `Announcement sent to ${row?.recipient_count ?? preview.length} clients. ${row?.connected_count ?? connectedCount} received an in-app notification.`,
    )
    setTitle('')
    setBody('Hi {{client_first_name}},\n\n')
    setPushRequested(false)
    setPreview([])
    setPreviewed(false)
    await load()
  }

  return (
    <main className="page applicationPage">
      <header className="applicationHeader">
        <div>
          <Link className="backLink" href="/dashboard">
            ← BrokerDesk
          </Link>
          <p className="eyebrow">MILESTONE 5</p>
          <h1>Announcements</h1>
          <p className="muted">
            Send one message to the right group of clients without selecting every
            application individually.
          </p>
        </div>
        <div className="systemOfRecord">
          Preview audience before sending
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <section className="card" style={{ marginBottom: 16 }}>
        <p className="eyebrow">1 · AUDIENCE</p>
        <h2>Who should receive this?</h2>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(Object.keys(audienceLabels) as AudienceType[]).map((value) => (
            <button
              key={value}
              type="button"
              className={audienceType === value ? '' : 'secondary'}
              onClick={() => setAudienceType(value)}
            >
              {audienceLabels[value]}
            </button>
          ))}
        </div>

        {audienceType === 'lenders' && (
          <div style={{ marginTop: 18 }}>
            <strong>Select lender(s)</strong>
            {lenders.length === 0 ? (
              <p className="muted">
                No lenders have been saved yet. Add a lender from an application
                first.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                {lenders.map((lender) => (
                  <label key={lender.id}>
                    <input
                      type="checkbox"
                      checked={selectedLenders.includes(lender.id)}
                      onChange={() => toggleLender(lender.id)}
                    />{' '}
                    {lender.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {audienceType === 'selected_clients' && (
          <div style={{ marginTop: 18 }}>
            <strong>Select clients</strong>
            <div
              style={{
                display: 'grid',
                gap: 8,
                marginTop: 10,
                maxHeight: 260,
                overflow: 'auto',
              }}
            >
              {clients.map((client) => (
                <label key={client.id}>
                  <input
                    type="checkbox"
                    checked={selectedClients.includes(client.id)}
                    onChange={() => toggleClient(client.id)}
                  />{' '}
                  {client.first_name} {client.last_name}
                  {client.email ? ` · ${client.email}` : ''}
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          className="secondary"
          style={{ marginTop: 18 }}
          onClick={previewAudience}
          disabled={busy}
        >
          {busy ? 'Checking…' : 'Preview recipients'}
        </button>

        {previewed && (
          <div className="clientNotePreview" style={{ marginTop: 14 }}>
            <strong>
              {preview.length} recipient{preview.length === 1 ? '' : 's'}
            </strong>
            <br />
            {connectedCount} connected to AidezConnect
            {preview.length - connectedCount > 0 && (
              <>
                <br />
                {preview.length - connectedCount} not connected — retained in the
                recipient record but cannot receive an in-app notification yet
              </>
            )}

            {preview.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer' }}>
                  View recipient names
                </summary>
                <div style={{ marginTop: 8 }}>
                  {preview.map((row) => (
                    <div key={row.client_id}>
                      {row.client_name}
                      {!row.connected ? ' · not connected' : ''}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <p className="eyebrow">2 · MESSAGE</p>
        <h2>Write announcement</h2>
        <p className="muted">
          Available placeholders: <code>{'{{client_first_name}}'}</code> and{' '}
          <code>{'{{broker_first_name}}'}</code>.
        </p>

        <div className="applicationForm">
          <label>
            Title
            <input
              maxLength={120}
              value={title}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setTitle(event.target.value)
              }
              placeholder="e.g. RBA Interest Rate Update"
            />
          </label>

          <label>
            Message
            <textarea
              rows={8}
              maxLength={4000}
              value={body}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setBody(event.target.value)
              }
            />
          </label>

          <label>
            <input
              type="checkbox"
              checked={pushRequested}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setPushRequested(event.target.checked)
              }
            />{' '}
            Send phone push notification when native push is enabled
          </label>

          <span className="muted smallText">
            In-app delivery works now. Native iPhone/Android push will use this
            selection once APNs/FCM is connected.
          </span>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <p className="eyebrow">3 · SEND</p>
        <h2>Confirm audience and send</h2>
        <p className="muted">
          AidezConnect deliberately requires an audience preview immediately
          before sending a group announcement.
        </p>
        <button
          onClick={sendAnnouncement}
          disabled={busy || !previewed || preview.length === 0}
        >
          {busy
            ? 'Sending…'
            : `Send to ${previewed ? preview.length : 0} client${preview.length === 1 ? '' : 's'}`}
        </button>
      </section>

      <section className="card">
        <p className="eyebrow">ANNOUNCEMENT HISTORY</p>
        <h2>Recent announcements</h2>

        {history.length === 0 ? (
          <p className="muted">No announcements have been sent yet.</p>
        ) : (
          <div className="statusHistory">
            {history.map((row) => (
              <div className="historyItem" key={row.announcement_id}>
                <div className="historyDot" />
                <div style={{ width: '100%' }}>
                  <strong>{row.title}</strong>
                  <div className="muted smallText">
                    {new Date(row.sent_at).toLocaleString()} ·{' '}
                    {audienceLabels[row.audience_type]}
                    {row.push_requested ? ' · push requested' : ''}
                  </div>
                  <p className="muted">
                    Recipients {row.recipient_count} · Connected{' '}
                    {row.connected_count} · Read {row.read_count}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
