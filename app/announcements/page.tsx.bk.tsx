'use client'

import Link from 'next/link'
import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'
import './announcements.css'

type Scope = 'my_clients' | 'all_company'

type Lender = { id: string; name: string }
type FollowUpTemplate = { template_key: string; title_template: string; body_template: string }
const followUpNames: Record<string, string> = {
  settlement_1_month: '👋 One-month check-in',
  settlement_3_month: '📋 Three-month check-in',
  settlement_6_month: '🔎 Six-month loan review',
  settlement_12_month: '📅 First annual review',
  settlement_annual: '🔁 Annual review',
}
type PreviewRow = { client_id: string; client_name: string; email: string | null; connected: boolean }
type HistoryRow = {
  announcement_id: string
  title: string
  audience_type: string
  push_requested: boolean
  recipient_count: number
  connected_count: number
  read_count: number
  sent_at: string
}

export default function AnnouncementsPage() {
  const [organisationId, setOrganisationId] = useState<string | null>(null)
  const [canCompany, setCanCompany] = useState(false)
  const [lenders, setLenders] = useState<Lender[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [followUps, setFollowUps] = useState<FollowUpTemplate[]>([])
  const [followUpKey, setFollowUpKey] = useState('')
  const [scope, setScope] = useState<Scope>('my_clients')
  const [lenderId, setLenderId] = useState('')
  const [baseRecipients, setBaseRecipients] = useState<PreviewRow[]>([])
  const [selectSpecific, setSelectSpecific] = useState(false)
  const [selectedClients, setSelectedClients] = useState<string[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('Hi {{client_first_name}},\n\n')
  const [pushRequested, setPushRequested] = useState(false)
  const [loadingRecipients, setLoadingRecipients] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [accountName, setAccountName] = useState('Broker')
  const [companyName, setCompanyName] = useState('BrokerDesk')
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null)
  const [canManageStaff, setCanManageStaff] = useState(false)
  const [isPlatformOwner, setIsPlatformOwner] = useState(false)

  async function load() {
    setError('')
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) { window.location.href = '/login'; return }

    const [{ data: profile }, { data: accessData }, { data: owner }] = await Promise.all([
      supabase.from('profiles').select('first_name,last_name').eq('id', auth.user.id).maybeSingle(),
      supabase.rpc('get_my_portal_access'),
      supabase.from('platform_admins').select('user_id').eq('user_id', auth.user.id).maybeSingle(),
    ])
    setAccountName([profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || auth.user.email || 'Broker')
    setCanManageStaff(Boolean(accessData?.can_manage_staff))
    setIsPlatformOwner(Boolean(owner) && auth.user.email?.toLowerCase() === 'aruna@aidez.com.au')

    const { data: broker, error: brokerError } = await supabase
      .from('broker_profiles').select('organisation_id')
      .eq('user_id', auth.user.id).eq('is_active', true).limit(1).single()
    if (brokerError) { setError(brokerError.message); return }

    const orgId = broker.organisation_id as string
    setOrganisationId(orgId)
    const { data: organisation } = await supabase.from('organisations').select('name,logo_url').eq('id', orgId).maybeSingle()
    setCompanyName(organisation?.name ?? 'BrokerDesk')
    setCompanyLogoUrl(organisation?.logo_url ?? null)

    const [lenderResult, permissionResult, historyResult, templatesResult] = await Promise.all([
      supabase.from('lenders').select('id,name').eq('organisation_id', orgId).eq('active', true).order('name'),
      supabase.rpc('get_announcement_permissions', { p_organisation_id: orgId }),
      supabase.rpc('get_announcement_history', { p_organisation_id: orgId, p_limit: 30 }),
      supabase.rpc('get_my_followup_templates', { p_organisation_id: orgId }),
    ])

    setLenders((lenderResult.data ?? []) as Lender[])
    if (permissionResult.error) setError(permissionResult.error.message)
    else {
      const row = Array.isArray(permissionResult.data) ? permissionResult.data[0] : permissionResult.data
      setCanCompany(Boolean(row?.can_send_company_announcements))
    }
    if (historyResult.error) setError(historyResult.error.message)
    else setHistory((historyResult.data ?? []) as HistoryRow[])
    if (templatesResult.error) setError(templatesResult.error.message)
    else setFollowUps(((templatesResult.data ?? []) as FollowUpTemplate[]).filter(row => row.template_key in followUpNames))
  }

  async function loadRecipients(orgId = organisationId, nextScope = scope, nextLenderId = lenderId) {
    if (!orgId) return
    setLoadingRecipients(true); setError('')
    const { data, error: previewError } = await supabase.rpc('preview_announcement_audience_v2', {
      p_organisation_id: orgId,
      p_scope: nextScope,
      p_lender_id: nextLenderId || null,
      p_client_ids: null,
    })
    setLoadingRecipients(false)
    if (previewError) { setError(previewError.message); setBaseRecipients([]); return }
    setBaseRecipients((data ?? []) as PreviewRow[])
    setSelectedClients([]); if (!followUpKey) setSelectSpecific(false); setShowReview(false)
  }

  useEffect(() => { void load() }, [])
  useEffect(() => { if (organisationId) void loadRecipients(organisationId, scope, lenderId) }, [organisationId, scope, lenderId])

  const effectiveRecipients = useMemo(() => {
    if (!selectSpecific) return baseRecipients
    const selected = new Set(selectedClients)
    return baseRecipients.filter(row => selected.has(row.client_id))
  }, [baseRecipients, selectSpecific, selectedClients])

  const visibleClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase()
    if (!q) return baseRecipients
    return baseRecipients.filter(row => `${row.client_name} ${row.email ?? ''}`.toLowerCase().includes(q))
  }, [baseRecipients, clientSearch])

  const connectedCount = useMemo(() => effectiveRecipients.filter(row => row.connected).length, [effectiveRecipients])

  function toggleClient(id: string) {
    setSelectedClients(current => followUpKey ? [id] : current.includes(id) ? current.filter(value => value !== id) : [...current, id])
    setShowReview(false)
  }

  function chooseFollowUp(key: string) {
    setFollowUpKey(key)
    setShowReview(false)
    if (!key) return
    const template = followUps.find(row => row.template_key === key)
    if (!template) return
    setTitle(template.title_template)
    setBody(template.body_template)
    setScope('my_clients')
    setLenderId('')
    setSelectSpecific(true)
    setSelectedClients([])
    setClientSearch('')
  }

  async function sendAnnouncement() {
    if (!organisationId || busy) return
    if (!title.trim()) { setError('Announcement title is required.'); return }
    if (!body.trim()) { setError('Announcement message is required.'); return }
    if (followUpKey && (effectiveRecipients.length !== 1 || body.includes('{{application_description}}') || title.includes('{{application_description}}'))) {
      setError('Choose one client and replace any application description placeholder before sending a follow-up.'); return
    }
    if (effectiveRecipients.length === 0) { setError('No clients match the selected recipients.'); return }
    if (!window.confirm(`Send "${title.trim()}" to ${effectiveRecipients.length} client${effectiveRecipients.length === 1 ? '' : 's'}?`)) return

    setBusy(true); setError(''); setNotice('')
    const { data, error: sendError } = await supabase.rpc('send_announcement_v2', {
      p_organisation_id: organisationId,
      p_scope: scope,
      p_title: title.trim(),
      p_body: body.trim(),
      p_push_requested: pushRequested,
      p_lender_id: lenderId || null,
      p_client_ids: selectSpecific ? selectedClients : null,
    })
    setBusy(false)
    if (sendError) { setError(sendError.message); return }

    const row = Array.isArray(data) ? data[0] : data
    setNotice(`Announcement sent to ${row?.recipient_count ?? effectiveRecipients.length} clients. ${row?.connected_count ?? connectedCount} received an in-app announcement.`)
    setTitle(''); setBody('Hi {{client_first_name}},\n\n'); setFollowUpKey(''); setPushRequested(false); setShowReview(false)
    await load(); await loadRecipients()
  }

  function historyScopeLabel(value: string) {
    if (value === 'all_company') return 'Company clients'
    if (value === 'my_clients') return 'My clients'
    if (value === 'lenders') return 'Lender audience (legacy)'
    if (value === 'selected_clients') return 'Selected clients (legacy)'
    return value
  }

  async function signOut() {
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) { setError(`Could not sign out: ${signOutError.message}`); return }
    window.location.href = '/login'
  }

  return (
    <main className="brokerDeskShell announcementShell">
      <header className="brokerDeskHeader">
        <BrokerRelayBrand compact />
        <div className="brokerDeskAccount"><span className="announcementCompanyIdentity">{companyLogoUrl && <img src={companyLogoUrl} alt="" aria-hidden="true" />}{companyName}</span><details><summary><span className="brokerDeskAvatar">{accountName.charAt(0).toUpperCase()}</span><span>{accountName}</span>⌄</summary><div className="brokerDeskAccountMenu"><button type="button" onClick={signOut}>Sign out</button></div></details></div>
      </header>
      <div className="brokerDeskLayout"><nav className="brokerDeskNav" aria-label="Broker Desk navigation">
        <Link href="/dashboard">⌂ &nbsp; Home</Link>
        <Link href="/dashboard#clients">♙ &nbsp; Clients</Link>
        <Link href="/messages">✉ &nbsp; Messages</Link>
        <Link href="/applications">▤ &nbsp; Applications</Link>
        <Link href="/documents">▣ &nbsp; Document requests</Link>
        <Link href="/clients/team">♙ &nbsp; Manage team</Link>
        <Link href="/announcements" className="brokerDeskNavActive" aria-current="page">◈ &nbsp; Announcements</Link>
        <Link href="/settings/follow-up-templates">⚙ &nbsp; Follow-up settings</Link>
        {canManageStaff && <Link href="/admin">⚙ &nbsp; Company &amp; staff</Link>}
        {isPlatformOwner && <Link href="/platform/companies">▦ &nbsp; Platform companies</Link>}
      </nav><div className="brokerDeskMain announcementMain">
      <header className="applicationHeader announcementHeader">
        <div>
          <p className="eyebrow">CLIENT COMMUNICATION</p>
          <h1>Announcements</h1>
          <p className="muted">Send an occasional update to the right clients with as few steps as possible.</p>
        </div>
        <div className="systemOfRecord">Recipients checked before sending</div>
      </header>

      {error && <div className="notice error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <section className="card" style={{ marginBottom: 16, borderLeft: '4px solid var(--company-accent, #111878)' }}>
        <div className="sectionHead">
          <div><p className="eyebrow">RECIPIENTS</p><h2>Who should receive this?</h2></div>
          <span className="pill">{loadingRecipients ? 'Checking…' : `${effectiveRecipients.length} recipient${effectiveRecipients.length === 1 ? '' : 's'}`}</span>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <strong>1. Client group</strong>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 9 }}>
              <button type="button" className={scope === 'my_clients' ? '' : 'secondary'} onClick={() => setScope('my_clients')}>My clients</button>
              {canCompany && !followUpKey && <button type="button" className={scope === 'all_company' ? '' : 'secondary'} onClick={() => setScope('all_company')}>Company clients</button>}
            </div>
            {!canCompany && <p className="muted smallText" style={{ marginTop: 7 }}>Company-wide announcements are available only to the head broker or an authorised delegate.</p>}
          </div>

          <label>
            <strong>2. Lender filter</strong>
            <select value={lenderId} disabled={Boolean(followUpKey)} onChange={(event: ChangeEvent<HTMLSelectElement>) => setLenderId(event.target.value)} style={{ marginTop: 7 }}>
              <option value="">All lenders</option>
              {lenders.map(lender => <option value={lender.id} key={lender.id}>{lender.name}</option>)}
            </select>
            <span className="muted smallText">Optional. Choose a lender only when the announcement is relevant to clients associated with that lender.</span>
          </label>

          <div>
            <strong>3. Clients</strong>
            <label style={{ display: 'block', marginTop: 9 }}>
              <input type="radio" checked={!selectSpecific} disabled={Boolean(followUpKey)} onChange={() => { setSelectSpecific(false); setSelectedClients([]); setShowReview(false) }} />{' '}
              All matching clients ({baseRecipients.length})
            </label>
            <label style={{ display: 'block', marginTop: 7 }}>
              <input type="radio" checked={selectSpecific} onChange={() => { setSelectSpecific(true); setShowReview(false) }} />{' '}
              Select specific clients
            </label>

            {selectSpecific && <div style={{ marginTop: 12, padding: 14, border: '1px solid #e2e5ec', borderRadius: 12 }}>
              <input value={clientSearch} onChange={(event: ChangeEvent<HTMLInputElement>) => setClientSearch(event.target.value)} placeholder="Search client name or email" />
              <div style={{ display: 'grid', gap: 8, marginTop: 10, maxHeight: 260, overflow: 'auto' }}>
                {visibleClients.map(row => <label key={row.client_id}>
                  <input type={followUpKey ? 'radio' : 'checkbox'} name={followUpKey ? 'follow-up-client' : undefined} checked={selectedClients.includes(row.client_id)} onChange={() => toggleClient(row.client_id)} />{' '}
                  {row.client_name}{row.email ? ` · ${row.email}` : ''}
                </label>)}
              </div>
            </div>}
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <p className="eyebrow">MESSAGE</p><h2>Write announcement</h2>
        <div className="applicationForm">
          <label>Start with a follow-up message
            <select value={followUpKey} onChange={event => chooseFollowUp(event.target.value)}>
              <option value="">Write my own announcement</option>
              {followUps.map(row => <option key={row.template_key} value={row.template_key}>{followUpNames[row.template_key]}</option>)}
            </select>
          </label>
          {followUpKey && <p className="muted smallText">This sends an editable, one-off announcement to one client. Automatic follow-ups still follow the application settlement schedule. <Link href="/settings/follow-up-templates">Edit saved defaults</Link>.</p>}
          <label>Title<input maxLength={120} value={title} onChange={(event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)} placeholder="e.g. RBA Interest Rate Update" /></label>
          <label>Message<textarea rows={8} maxLength={4000} value={body} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setBody(event.target.value)} /></label>
          <span className="muted smallText">Personalise with <code>{'{{client_first_name}}'}</code> and <code>{'{{broker_first_name}}'}</code>.</span>
          <label><input type="checkbox" checked={pushRequested} onChange={(event: ChangeEvent<HTMLInputElement>) => setPushRequested(event.target.checked)} /> Phone push notification when native push is enabled</label>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="sectionHead">
          <div><p className="eyebrow">REVIEW & SEND</p><h2>{effectiveRecipients.length} client{effectiveRecipients.length === 1 ? '' : 's'}</h2><p className="muted">{connectedCount} currently connected to AidezConnect</p></div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="secondary" disabled={effectiveRecipients.length === 0} onClick={() => setShowReview(value => !value)}>{showReview ? 'Hide recipients' : 'Review recipients'}</button>
            <button type="button" disabled={busy || effectiveRecipients.length === 0} onClick={sendAnnouncement}>{busy ? 'Sending…' : 'Send announcement'}</button>
          </div>
        </div>
        {showReview && <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: '#f7f8fb' }}>
          {effectiveRecipients.map(row => <div key={row.client_id} style={{ padding: '5px 0' }}><strong>{row.client_name}</strong>{row.email ? ` · ${row.email}` : ''}{!row.connected ? ' · not connected' : ''}</div>)}
        </div>}
      </section>

      <section className="card">
        <p className="eyebrow">HISTORY</p><h2>Recent announcements</h2>
        {history.length === 0 ? <p className="muted">No announcements have been sent yet.</p> : <div className="statusHistory">
          {history.map(row => <div className="historyItem" key={row.announcement_id}>
            <div className="historyDot" />
            <div style={{ width: '100%' }}><strong>{row.title}</strong><div className="muted smallText">{new Date(row.sent_at).toLocaleString()} · {historyScopeLabel(row.audience_type)}{row.push_requested ? ' · push requested' : ''}</div><p className="muted">Recipients {row.recipient_count} · Connected {row.connected_count} · Read {row.read_count}</p></div>
          </div>)}
        </div>}
      </section>
      </div></div>
    </main>
  )
}
