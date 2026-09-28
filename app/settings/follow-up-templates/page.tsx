'use client'

import { ChangeEvent, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ApplicationWorkspaceShell } from '@/components/ApplicationWorkspaceShell'

type TemplateRow = {
  template_key: string
  title_template: string
  body_template: string
  template_source: 'broker' | 'company' | 'platform'
}
type CompanyMessage = { id: string; name: string; title_template: string; body_template: string }
const examples = {
  birthday: { name: '🎂 Birthday wishes', title: '🎉 Happy birthday, {{client_first_name}}!', body: 'Happy birthday, {{client_first_name}}! Wishing you a wonderful day and a great year ahead. – {{broker_first_name}}' },
  new_year: { name: '✨ New Year greetings', title: '✨ Happy New Year!', body: 'Hi {{client_first_name}}, wishing you and your family a happy and healthy New Year. Thank you for staying connected with us! – {{broker_first_name}}' },
}

const names: Record<string, string> = {
  conditional_approval: '🎉 Conditional approval',
  formal_approval: '✅ Full approval',
  settlement_scheduled: '🏡 Settlement ready',
  settlement_confirmation: '🔑 Settlement',
  settlement_1_month: '👋 One-month check-in',
  settlement_3_month: '📋 Three-month check-in',
  settlement_6_month: '🔎 Six-month loan review',
  settlement_12_month: '📅 First annual review',
  settlement_annual: '🔁 Annual reviews thereafter',
}

export default function FollowUpTemplateSettingsPage() {
  const [organisationId, setOrganisationId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [busyKey, setBusyKey] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [clientId, setClientId] = useState<string | undefined>()
  const [companyMessages, setCompanyMessages] = useState<CompanyMessage[]>([])
  const [canManageCompany, setCanManageCompany] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')
  const [customTitle, setCustomTitle] = useState('')
  const [customBody, setCustomBody] = useState('')

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

    const [{ data, error: templateError }, { data: companyRows, error: companyError }, { data: access }] = await Promise.all([
      supabase.rpc('get_my_followup_templates', { p_organisation_id: orgId }),
      supabase.from('company_message_templates').select('id,name,title_template,body_template').eq('organisation_id', orgId).order('name'),
      supabase.rpc('get_my_portal_access'),
    ])
    if (templateError) {
      setError(templateError.message)
      return
    }
    setTemplates((data ?? []) as TemplateRow[])
    if (companyError) setError(companyError.message)
    else setCompanyMessages((companyRows ?? []) as CompanyMessage[])
    setCanManageCompany(Boolean(access?.can_manage_company))
  }

  useEffect(() => {
    void load()
    const requestedClientId = new URLSearchParams(window.location.search).get('clientId')
    if (requestedClientId && /^[0-9a-f-]{36}$/i.test(requestedClientId)) setClientId(requestedClientId)
  }, [])

  function updateLocal(
    key: string,
    field: 'title_template' | 'body_template',
    value: string,
  ) {
    setTemplates((rows) =>
      rows.map((row) =>
        row.template_key === key ? { ...row, [field]: value } : row,
      ),
    )
  }

  async function save(row: TemplateRow) {
    if (!organisationId) return
    setBusyKey(row.template_key)
    setError('')
    setNotice('')

    const { error: saveError } = await supabase.rpc(
      'save_my_followup_template',
      {
        p_organisation_id: organisationId,
        p_template_key: row.template_key,
        p_title_template: row.title_template,
        p_body_template: row.body_template,
      },
    )

    setBusyKey('')
    if (saveError) {
      setError(saveError.message)
      return
    }
    setNotice(`${names[row.template_key]} saved as your broker wording.`)
    await load()
  }

  async function reset(row: TemplateRow) {
    if (!organisationId) return
    setBusyKey(row.template_key)
    setError('')
    setNotice('')

    const { error: resetError } = await supabase.rpc(
      'reset_my_followup_template',
      {
        p_organisation_id: organisationId,
        p_template_key: row.template_key,
      },
    )

    setBusyKey('')
    if (resetError) {
      setError(resetError.message)
      return
    }
    setNotice(`${names[row.template_key]} restored to company/platform wording.`)
    await load()
  }

  async function saveCompanyMessage() {
    if (!organisationId) return
    setBusyKey('company'); setError(''); setNotice('')
    const { error: saveError } = await supabase.rpc('save_company_message_template', {
      p_organisation_id: organisationId, p_id: editingId,
      p_name: customName, p_title: customTitle, p_body: customBody,
    })
    setBusyKey('')
    if (saveError) { setError(saveError.message); return }
    setEditingId(null); setCustomName(''); setCustomTitle(''); setCustomBody('')
    setNotice('Company message saved. It is now available when composing an announcement.')
    await load()
  }

  async function deleteCompanyMessage(id: string) {
    if (!organisationId || !window.confirm('Delete this saved company message?')) return
    setBusyKey('company'); setError('')
    const { error: deleteError } = await supabase.rpc('delete_company_message_template', { p_organisation_id: organisationId, p_id: id })
    setBusyKey('')
    if (deleteError) { setError(deleteError.message); return }
    setNotice('Company message deleted.'); await load()
  }

  return (
    <ApplicationWorkspaceShell clientId={clientId} section="settings">
      <header className="applicationHeader">
        <div>
          <p className="eyebrow">AUTOMATED CLIENT FOLLOW-UP</p>
          <h1>Follow-up message settings</h1>
          <p className="muted">
            Configure your milestone and follow-up wording once. BrokerRelay personalises
            future messages with the client&apos;s and broker&apos;s first names.
          </p>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <section className="card" style={{ marginBottom: 16 }}>
        <p className="eyebrow">AVAILABLE PLACEHOLDERS</p>
        <p>
          <code>{'{{client_first_name}}'}</code>{' '}
          <code>{'{{broker_first_name}}'}</code>{' '}
          <code>{'{{application_description}}'}</code>
        </p>
        <p className="muted">
          You do not need to edit messages for individual clients. These placeholders
          are filled automatically when the notification is sent.
        </p>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <p className="eyebrow">COMPANY MESSAGE LIBRARY</p>
        <h2>Saved messages for announcements</h2>
        <p className="muted">Create reusable messages for birthdays, New Year or other occasions. A broker chooses the recipients and sends each announcement manually; saving a message does not schedule it.</p>
        {companyMessages.length === 0 && <p className="muted">No company messages saved yet.</p>}
        {companyMessages.map(row => <div className="sectionHead" key={row.id} style={{ marginTop: 12 }}><div><strong>{row.name}</strong><p className="muted">{row.title_template}</p></div>
          {canManageCompany && <div className="row"><button type="button" className="secondary" onClick={() => { setEditingId(row.id); setCustomName(row.name); setCustomTitle(row.title_template); setCustomBody(row.body_template) }}>Edit</button><button type="button" className="secondary" disabled={busyKey === 'company'} onClick={() => void deleteCompanyMessage(row.id)}>Delete</button></div>}
        </div>)}
        {canManageCompany && <div className="applicationForm" style={{ marginTop: 20 }}>
          <h3>{editingId ? 'Edit company message' : 'Add company message'}</h3>
          <label>Start with an example
            <select defaultValue="" onChange={event => { const example = examples[event.target.value as keyof typeof examples]; if (example) { setCustomName(example.name); setCustomTitle(example.title); setCustomBody(example.body) } }}>
              <option value="">Write my own</option><option value="birthday">Birthday wishes</option><option value="new_year">New Year greetings</option>
            </select>
          </label>
          <label>Message name<input maxLength={80} value={customName} onChange={event => setCustomName(event.target.value)} placeholder="e.g. Birthday wishes" /></label>
          <label>Title<input maxLength={120} value={customTitle} onChange={event => setCustomTitle(event.target.value)} /></label>
          <label>Message<textarea maxLength={4000} rows={4} value={customBody} onChange={event => setCustomBody(event.target.value)} /></label>
          <div className="formFoot"><button type="button" disabled={busyKey === 'company' || !customName.trim() || !customTitle.trim() || !customBody.trim()} onClick={() => void saveCompanyMessage()}>{busyKey === 'company' ? 'Saving…' : 'Save company message'}</button>
            {editingId && <button type="button" className="secondary" onClick={() => { setEditingId(null); setCustomName(''); setCustomTitle(''); setCustomBody('') }}>Cancel edit</button>}
          </div>
        </div>}
      </section>
      <p className="muted">Approval and settlement updates are sent when an application moves to that stage. Later check-ins are scheduled from its settlement date.</p>
      <div style={{ display: 'grid', gap: 16 }}>
        {templates.map((row) => (
          <section className="card" key={row.template_key}>
            <div className="sectionHead">
              <div>
                <p className="eyebrow">{names[row.template_key]}</p>
                <h2>{row.title_template}</h2>
              </div>
              <span className="systemOfRecord">
                {row.template_source === 'broker'
                  ? 'Your wording'
                  : row.template_source === 'company'
                    ? 'Company wording'
                    : 'BrokerRelay default'}
              </span>
            </div>

            <div className="applicationForm">
              <label>
                Notification title
                <input
                  maxLength={120}
                  value={row.title_template}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateLocal(
                      row.template_key,
                      'title_template',
                      event.target.value,
                    )
                  }
                />
              </label>

              <label>
                Message
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={row.body_template}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    updateLocal(
                      row.template_key,
                      'body_template',
                      event.target.value,
                    )
                  }
                />
              </label>

              <div className="formFoot">
                <button
                  onClick={() => void save(row)}
                  disabled={busyKey === row.template_key}
                >
                  {busyKey === row.template_key ? 'Saving…' : 'Save my wording'}
                </button>
                <button
                  className="secondary"
                  onClick={() => void reset(row)}
                  disabled={
                    busyKey === row.template_key ||
                    row.template_source !== 'broker'
                  }
                >
                  Use company/default wording
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </ApplicationWorkspaceShell>
  )
}
