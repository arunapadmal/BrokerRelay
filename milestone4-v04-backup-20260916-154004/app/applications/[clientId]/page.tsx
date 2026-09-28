'use client'

import Link from 'next/link'
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const statuses = [
  'preparing_application',
  'documents_required',
  'ready_to_submit',
  'submitted',
  'under_assessment',
  'conditional_approval',
  'formal_approval',
  'loan_documents_issued',
  'settlement_scheduled',
  'settled',
  'on_hold',
  'withdrawn',
] as const

type ApplicationStatus = typeof statuses[number]

type Client = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  mobile: string | null
}

type Application = {
  id: string
  application_reference: string | null
  application_description: string | null
  status: ApplicationStatus
  client_note: string | null
  settlement_date: string | null
  status_updated_at: string
  created_at: string
}

type History = {
  id: number
  to_status: ApplicationStatus
  client_note: string | null
  created_at: string
}

const labels: Record<string, string> = {
  preparing_application: 'Preparing Application',
  documents_required: 'Documents Required',
  ready_to_submit: 'Ready to Submit',
  submitted: 'Submitted',
  under_assessment: 'Under Assessment',
  conditional_approval: 'Conditional Approval',
  formal_approval: 'Formal Approval',
  loan_documents_issued: 'Loan Documents Issued',
  settlement_scheduled: 'Settlement Scheduled',
  settled: 'Settled',
  on_hold: 'On Hold',
  withdrawn: 'Withdrawn',
}

const label = (value: string) => labels[value] ?? value

export default function ClientApplicationsPage() {
  const params = useParams<{ clientId: string }>()
  const clientId = params.clientId

  const [client, setClient] = useState<Client | null>(null)
  const [apps, setApps] = useState<Application[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [history, setHistory] = useState<History[]>([])

  const [newRef, setNewRef] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] =
    useState<ApplicationStatus>('preparing_application')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selected = useMemo(
    () => apps.find((application) => application.id === selectedId) ?? null,
    [apps, selectedId],
  )

  async function load() {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) {
      window.location.href = '/login'
      return
    }

    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .select('id,first_name,last_name,email,mobile')
      .eq('id', clientId)
      .single()

    if (clientError) {
      setError(clientError.message)
      return
    }
    setClient(clientData as Client)

    const { data: applicationData, error: applicationError } = await supabase
      .from('loan_applications')
      .select(
        'id,application_reference,application_description,status,client_note,settlement_date,status_updated_at,created_at',
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })

    if (applicationError) {
      setError(applicationError.message)
      return
    }

    const rows = (applicationData ?? []) as Application[]
    setApps(rows)
    setSelectedId((previous) =>
      previous && rows.some((row) => row.id === previous)
        ? previous
        : (rows.at(-1)?.id ?? null),
    )
  }

  async function loadHistory(applicationId: string) {
    const { data, error: historyError } = await supabase
      .from('application_status_history')
      .select('id,to_status,client_note,created_at')
      .eq('application_id', applicationId)
      .order('created_at')

    if (historyError) {
      setError(historyError.message)
      return
    }
    setHistory((data ?? []) as History[])
  }

  useEffect(() => {
    void load()

    const channel = supabase
      .channel(`m4-v03-${clientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'loan_applications',
          filter: `client_id=eq.${clientId}`,
        },
        () => {
          void load()
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'application_status_history',
          filter: `client_id=eq.${clientId}`,
        },
        () => {
          if (selectedId) void loadHistory(selectedId)
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [clientId, selectedId])

  useEffect(() => {
    if (!selected) {
      setHistory([])
      return
    }
    setReference(selected.application_reference ?? '')
    setDescription(selected.application_description ?? '')
    setStatus(selected.status)
    setDate(selected.settlement_date ?? '')
    setNote('')
    void loadHistory(selected.id)
  }, [selectedId, apps.length])

  async function createApplication(event: FormEvent) {
    event.preventDefault()
    if (busy) return

    if (newDescription.trim().length > 160) {
      setError('Application description must be 160 characters or less.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    const { data, error: createError } = await supabase.rpc(
      'create_loan_application_v2',
      {
        p_client_id: clientId,
        p_application_reference: newRef.trim() || null,
        p_application_description: newDescription.trim() || null,
        p_status: 'preparing_application',
        p_settlement_date: null,
        p_client_note: 'Your mortgage application is being prepared.',
      },
    )

    setBusy(false)
    if (createError) {
      setError(createError.message)
      return
    }

    const row = Array.isArray(data) ? data[0] : data
    setNewRef('')
    setNewDescription('')
    setNotice(
      'New application created. The connected client also receives an AidezConnect notification.',
    )
    await load()
    if (row?.application_id) setSelectedId(row.application_id)
  }

  async function saveDetails() {
    if (!selected || busy) return

    if (description.trim().length > 160) {
      setError('Application description must be 160 characters or less.')
      return
    }

    setBusy(true)
    setError('')
    const { error: detailsError } = await supabase.rpc(
      'update_loan_application_details',
      {
        p_application_id: selected.id,
        p_application_reference: reference.trim() || null,
        p_application_description: description.trim() || null,
      },
    )
    setBusy(false)

    if (detailsError) {
      setError(detailsError.message)
      return
    }

    setNotice(
      'Application reference and client-friendly description updated.',
    )
    await load()
  }

  async function updateStatus(event: FormEvent) {
    event.preventDefault()
    if (!selected || busy) return

    if (status === 'settled' && !date) {
      setError('Settlement date is required when status is Settled.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    const includeSettlementDate =
      status === 'settled' || status === 'settlement_scheduled'

    const { error: statusError } = await supabase.rpc(
      'update_loan_application_status',
      {
        p_application_id: selected.id,
        p_status: status,
        p_settlement_date:
          includeSettlementDate && date ? date : null,
        p_client_note: note.trim() || null,
      },
    )

    setBusy(false)
    if (statusError) {
      setError(statusError.message)
      return
    }

    setNote('')
    setNotice(
      `${description || reference || 'Application'} updated to ${label(status)}. ` +
        'If the status changed, the connected client receives an AidezConnect notification.',
    )
    await load()
    await loadHistory(selected.id)
  }

  const clientName = client
    ? `${client.first_name} ${client.last_name}`
    : 'Client'
  const selectedName = description || reference || 'Selected application'

  return (
    <main className="page applicationPage">
      <header className="applicationHeader">
        <div>
          <Link className="backLink" href="/dashboard">
            ← Connected clients
          </Link>
          <p className="eyebrow">LOAN / APPLICATION PROGRESS</p>
          <h1>{clientName}</h1>
          <p className="muted">
            Each application has its own description, status and timeline.
          </p>
        </div>
        <div className="systemOfRecord">CRM remains system of record</div>
      </header>

      {error && <div className="notice error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="sectionHead">
          <div>
            <p className="eyebrow">APPLICATIONS</p>
            <h2>
              {apps.length} {apps.length === 1 ? 'application' : 'applications'}
            </h2>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {apps.map((application, index) => (
            <button
              key={application.id}
              className={application.id === selectedId ? '' : 'secondary'}
              onClick={() => setSelectedId(application.id)}
            >
              {application.application_description ||
                application.application_reference ||
                `Application ${index + 1}`}{' '}
              · {label(application.status)}
            </button>
          ))}
        </div>

        <form
          onSubmit={createApplication}
          className="applicationForm"
          style={{ marginTop: 22 }}
        >
          <label>
            Client-friendly application description
            <input
              value={newDescription}
              maxLength={160}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setNewDescription(event.target.value)
              }
              placeholder="e.g. Home Purchase – 12 Smith Street"
            />
            <span className="muted smallText">
              Examples: Home Purchase – 12 Smith Street · Refinance –
              Investment Property · Pre-approval
            </span>
          </label>
          <label>
            CRM / application reference
            <input
              value={newRef}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setNewRef(event.target.value)
              }
              placeholder="e.g. AOL03 or CRM-12345"
            />
          </label>
          <button disabled={busy}>
            {busy ? 'Creating…' : '+ New application'}
          </button>
        </form>
      </section>

      {selected && (
        <>
          <section className="applicationGrid">
            <div className="card">
              <p className="eyebrow">SELECTED APPLICATION</p>
              <div className="statusHero">{selectedName}</div>
              {description && reference && (
                <p className="muted">Reference: {reference}</p>
              )}
              <strong>{label(selected.status)}</strong>
              <p className="muted">
                Updated {new Date(selected.status_updated_at).toLocaleString()}
              </p>
              {selected.client_note && (
                <div className="clientNotePreview">
                  <strong>Client sees:</strong>
                  <br />
                  {selected.client_note}
                </div>
              )}
            </div>

            <div className="card">
              <p className="eyebrow">APPLICATION IDENTITY</p>
              <label>
                Client-friendly description
                <input
                  value={description}
                  maxLength={160}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setDescription(event.target.value)
                  }
                  placeholder="Home Purchase – 12 Smith Street"
                />
              </label>
              <label style={{ marginTop: 12 }}>
                CRM reference
                <input
                  value={reference}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setReference(event.target.value)
                  }
                />
              </label>
              <button
                className="secondary"
                onClick={saveDetails}
                disabled={busy}
              >
                Save application details
              </button>
            </div>
          </section>

          <section className="card statusUpdateCard">
            <p className="eyebrow">
              UPDATE {selectedName.toUpperCase()}
            </p>
            <h2>Publish status</h2>
            <p className="muted">
              A real-time AidezConnect notification is created when the status
              changes. Client-facing notes stay inside this application&apos;s
              progress thread.
            </p>

            <form onSubmit={updateStatus} className="applicationForm">
              <label>
                Status
                <select
                  value={status}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setStatus(event.target.value as ApplicationStatus)
                  }
                >
                  {statuses.map((item) => (
                    <option key={item} value={item}>
                      {label(item)}
                    </option>
                  ))}
                </select>
              </label>

              {(status === 'settlement_scheduled' ||
                status === 'settled') && (
                <label>
                  Settlement date
                  <input
                    type="date"
                    value={date}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setDate(event.target.value)
                    }
                  />
                </label>
              )}

              <label>
                Client-facing update
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={note}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    setNote(event.target.value)
                  }
                />
              </label>

              <div className="formFoot">
                <span>
                  {note.length}/1000 · visible only in this application&apos;s
                  thread
                </span>
                <button disabled={busy}>
                  {busy ? 'Updating…' : 'Publish progress update'}
                </button>
              </div>
            </form>
          </section>

          <section className="card">
            <p className="eyebrow">{selectedName.toUpperCase()} HISTORY</p>
            <h2>Separate progress timeline</h2>
            <div className="statusHistory">
              {history.map((item) => (
                <div className="historyItem" key={item.id}>
                  <div className="historyDot" />
                  <div>
                    <strong>{label(item.to_status)}</strong>
                    <div className="muted smallText">
                      {new Date(item.created_at).toLocaleString()}
                    </div>
                    {item.client_note && <p>{item.client_note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
